import { existsSync, mkdirSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { AgentProvider, AgentSummary } from "./agents/agent.js";
import type { SandboxProvider, SandboxSummary } from "./sandbox/sandbox.js";
import {
  composeSystemPrompt,
  resolveIntent,
  type IntentScopeKind,
  type ResolvedIntent,
} from "./intents.js";
import { fireHook, type HooksConfig } from "./hooks.js";

export type CommitStyle = "conventional" | "custom";

export interface GitConfig {
  branchPattern?: string;
  commitStyle?: CommitStyle;
  commitTemplate?: string;
  defaultBranch?: string;
}

export interface BurrowConfig {
  agent: AgentProvider;
  sandbox: SandboxProvider;
  cwd?: string;
  burrowDir?: string;
  systemPrompt?: string;
  hooks?: HooksConfig;
  git?: GitConfig;
  watch?: boolean;
}

export interface IntentResourceSummary {
  name: string;
  scope?: IntentScopeKind;
}

export interface IntentInferred {
  agent: AgentSummary;
  sandbox: SandboxSummary;
  cwd?: string;
  systemPrompt: boolean;
  systemPromptLines?: number;
  git?: { branchPattern?: string; commitStyle?: CommitStyle; defaultBranch: string };
  intent?: {
    name: string;
    type: string;
    description?: string;
    scope?: IntentScopeKind;
  };
  agents: IntentResourceSummary[];
  skills: IntentResourceSummary[];
  context: IntentResourceSummary[];
  docs: IntentResourceSummary[];
}

function composeGitSection(git: GitConfig): string {
  if (git.commitStyle === "custom" && !git.commitTemplate) {
    throw new Error(
      'GitConfig: commitStyle "custom" requires commitTemplate to be set'
    );
  }

  if (git.branchPattern && !git.branchPattern.includes("<slug>")) {
    throw new Error(
      `GitConfig: branchPattern "${git.branchPattern}" must contain the "<slug>" placeholder`
    );
  }

  const lines: string[] = ["# Git Workflow"];

  const example = git.branchPattern
    ? git.branchPattern.replace("<slug>", "your-task-slug")
    : "your-task-slug";
  lines.push(
    "",
    "Before making any changes, create a branch:",
    `  git checkout -b ${example}`,
    "Replace the slug with a short kebab-case description of the task."
  );
  if (git.branchPattern) {
    lines.push(`Branch pattern: \`${git.branchPattern}\``);
  }

  if (git.commitStyle === "conventional") {
    lines.push(
      "",
      "Use conventional commits: `<type>(<scope>): <description>`",
      "Types: feat, fix, docs, style, refactor, perf, test, chore",
      "Examples: `feat: add login endpoint`, `fix(auth): handle expired tokens`"
    );
  } else if (git.commitStyle === "custom") {
    lines.push("", `Commit message template: ${git.commitTemplate}`);
  }

  const base = git.defaultBranch ?? "main";
  lines.push(
    "",
    "After completing the task, run these steps in order — all are required:",
    "  1. git add -A",
    `  2. git commit -m "<message>"`,
    "  3. git push -u origin HEAD",
    `  4. gh pr create --base ${base} --title "<concise title>" --body "<what changed and why>"`,
    "The task is not finished until the PR is open."
  );

  return lines.join("\n");
}

export class Intent {
  constructor(
    readonly prompt: string,
    readonly inferred: IntentInferred,
    readonly resolved: ResolvedIntent | null
  ) {}
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function recordTask(burrowDir: string, intent: Intent): void {
  const tasksDir = join(burrowDir, "tasks");
  if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = slugify(intent.prompt) || "task";
  const file = join(tasksDir, `${ts}-${slug}-${randomUUID()}.json`);
  const resolved = intent.resolved
    ? {
        name: intent.resolved.name,
        type: intent.resolved.type,
        description: intent.resolved.description,
        scope: intent.resolved.scope,
        agents: intent.resolved.agents.map((r) => ({ name: r.name, scope: r.scope })),
        skills: intent.resolved.skills.map((r) => ({ name: r.name, scope: r.scope })),
        context: intent.resolved.context.map((r) => ({ name: r.name, scope: r.scope })),
        docs: intent.resolved.docs.map((r) => ({ name: r.name, scope: r.scope })),
      }
    : null;
  const record = {
    timestamp: new Date().toISOString(),
    prompt: intent.prompt,
    inferred: intent.inferred,
    resolved,
  };
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
}

export class Task {
  constructor(
    private readonly intent: Intent,
    private readonly config: BurrowConfig
  ) {}

  async *run(): AsyncGenerator<unknown> {
    const sections: string[] = [];
    const base = composeSystemPrompt(this.config.systemPrompt, this.intent.resolved);
    if (base) sections.push(base);
    if (this.config.git) sections.push(composeGitSection(this.config.git));
    const systemPrompt = sections.length ? sections.join("\n\n---\n\n") : undefined;

    const burrowDir =
      this.config.burrowDir ??
      (this.config.cwd ? join(this.config.cwd, ".burrow") : undefined);
    if (burrowDir) {
      try {
        recordTask(burrowDir, this.intent);
      } catch {
        // task tracking is best-effort; never fail the run on a write error
      }
    }

    const hooks = this.config.hooks;
    const cwd = this.config.cwd;
    const prompt = this.intent.prompt;
    const resolved = this.intent.resolved;

    await fireHook(hooks, { event: "SessionStart", prompt, cwd }, cwd);
    await fireHook(
      hooks,
      {
        event: "IntentResolved",
        prompt,
        cwd,
        intent: resolved
          ? {
              name: resolved.name,
              type: resolved.type,
              description: resolved.description,
              scope: resolved.scope,
            }
          : null,
        agents: (resolved?.agents ?? []).map((r) => r.name),
        skills: (resolved?.skills ?? []).map((r) => r.name),
        context: (resolved?.context ?? []).map((r) => r.name),
        docs: (resolved?.docs ?? []).map((r) => r.name),
      },
      cwd
    );

    let resultSubtype: string | undefined;
    let resultCost: number | undefined;
    let finalMessage: string | undefined;

    const errorMessage = (err: unknown): string =>
      err instanceof Error ? err.message : String(err);

    let ctx;
    try {
      ctx = await this.config.sandbox.start();
    } catch (err) {
      await fireHook(
        hooks,
        { event: "SessionError", prompt, cwd, error: errorMessage(err) },
        cwd
      );
      await fireHook(
        hooks,
        {
          event: "SessionEnd",
          prompt,
          cwd,
          status: "error",
          summary: `Failed: sandbox start (${errorMessage(err)})`,
        },
        cwd
      );
      throw err;
    }

    let runError: unknown;
    try {
      for await (const message of this.config.agent.run(prompt, {
        cwd,
        systemPrompt,
        env: ctx.env,
      })) {
        const m = message as {
          type?: string;
          subtype?: string;
          total_cost_usd?: number;
          message?: { content?: Array<{ type: string; text?: string }> };
        };
        if (m.type === "result") {
          resultSubtype = m.subtype;
          resultCost = m.total_cost_usd;
        } else if (m.type === "assistant" && m.message?.content) {
          for (const block of m.message.content) {
            if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
              finalMessage = block.text;
            }
          }
        }
        yield message;
      }
    } catch (err) {
      runError = err;
      await fireHook(
        hooks,
        { event: "SessionError", prompt, cwd, error: errorMessage(err) },
        cwd
      );
    } finally {
      try {
        await this.config.sandbox.stop();
      } catch (err) {
        await fireHook(
          hooks,
          { event: "SessionError", prompt, cwd, error: errorMessage(err) },
          cwd
        );
      }
    }

    const status: "success" | "error" =
      !runError && resultSubtype === "success" ? "success" : "error";
    const summary =
      status === "success"
        ? "Completed"
        : runError
          ? `Failed: ${errorMessage(runError)}`
          : `Failed: ${resultSubtype ?? "unknown"}`;
    await fireHook(
      hooks,
      {
        event: "SessionEnd",
        prompt,
        cwd,
        status,
        summary,
        subtype: resultSubtype,
        cost: resultCost,
        finalMessage,
      },
      cwd
    );

    if (runError) throw runError;
  }
}

export class Burrow {
  readonly watch: boolean;

  constructor(private readonly config: BurrowConfig) {
    this.watch = config.watch ?? false;
  }

  intent(prompt: string): Intent {
    const sp = this.config.systemPrompt;
    const burrowDir =
      this.config.burrowDir ??
      (this.config.cwd ? join(this.config.cwd, ".burrow") : undefined);
    const resolved = resolveIntent(burrowDir, prompt);
    const git = this.config.git;

    return new Intent(
      prompt,
      {
        agent: this.config.agent.summary ?? { name: "agent" },
        sandbox: this.config.sandbox.summary ?? { name: "sandbox" },
        cwd: this.config.cwd,
        systemPrompt: !!sp,
        systemPromptLines: sp ? sp.split("\n").length : undefined,
        git: git
          ? {
              branchPattern: git.branchPattern,
              commitStyle: git.commitStyle,
              defaultBranch: git.defaultBranch ?? "main",
            }
          : undefined,
        intent: resolved
          ? {
              name: resolved.name,
              type: resolved.type,
              description: resolved.description,
              scope: resolved.scope,
            }
          : undefined,
        agents: (resolved?.agents ?? []).map((r) => ({ name: r.name, scope: r.scope })),
        skills: (resolved?.skills ?? []).map((r) => ({ name: r.name, scope: r.scope })),
        context: (resolved?.context ?? []).map((r) => ({ name: r.name, scope: r.scope })),
        docs: (resolved?.docs ?? []).map((r) => ({ name: r.name, scope: r.scope })),
      },
      resolved
    );
  }

  task(intent: Intent): Task {
    return new Task(intent, this.config);
  }
}

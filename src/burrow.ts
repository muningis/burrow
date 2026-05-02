import { join } from "path";
import type { AgentProvider, AgentSummary } from "./agents/agent.js";
import type { SandboxProvider, SandboxSummary } from "./sandbox/sandbox.js";
import {
  composeSystemPrompt,
  resolveIntent,
  type IntentScopeKind,
  type ResolvedIntent,
} from "./intents.js";

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
  hooks?: Record<string, unknown>;
  git?: GitConfig;
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
  git?: { branchPattern?: string; commitStyle?: string; defaultBranch?: string };
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
  const lines: string[] = ["# Git Workflow"];

  if (git.branchPattern) {
    const example = git.branchPattern.replace("<slug>", "your-task-slug");
    lines.push(
      "",
      "Before making any changes, create a branch:",
      `  git checkout -b ${example}`,
      `Replace the slug with a short kebab-case description of the task.`,
      `Branch pattern: \`${git.branchPattern}\``
    );
  }

  if (git.commitStyle === "conventional") {
    lines.push(
      "",
      "Use conventional commits: `<type>(<scope>): <description>`",
      "Types: feat, fix, docs, style, refactor, perf, test, chore",
      "Examples: `feat: add login endpoint`, `fix(auth): handle expired tokens`"
    );
  } else if (git.commitStyle === "custom" && git.commitTemplate) {
    lines.push("", `Commit message template: ${git.commitTemplate}`);
  }

  const base = git.defaultBranch ?? "main";
  lines.push(
    "",
    "After completing the task, open a pull request with the gh CLI:",
    `  gh pr create --base ${base} --title "<concise title>" --body "<what changed and why>"`
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

export class Task {
  constructor(
    private readonly intent: Intent,
    private readonly config: BurrowConfig
  ) {}

  async *run(): AsyncGenerator<unknown> {
    const ctx = await this.config.sandbox.start();
    try {
      const sections: string[] = [];
      const base = composeSystemPrompt(this.config.systemPrompt, this.intent.resolved);
      if (base) sections.push(base);
      if (this.config.git) sections.push(composeGitSection(this.config.git));
      const systemPrompt = sections.length ? sections.join("\n\n---\n\n") : undefined;

      yield* this.config.agent.run(this.intent.prompt, {
        cwd: this.config.cwd,
        systemPrompt,
        env: ctx.env,
      });
    } finally {
      await this.config.sandbox.stop();
    }
  }
}

export class Burrow {
  constructor(private readonly config: BurrowConfig) {}

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
              defaultBranch: git.defaultBranch,
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

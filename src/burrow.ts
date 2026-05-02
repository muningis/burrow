import { join } from "path";
import type { AgentProvider, AgentSummary } from "./agents/agent.js";
import type { SandboxProvider, SandboxSummary } from "./sandbox/sandbox.js";
import {
  composeSystemPrompt,
  resolveIntent,
  type IntentScopeKind,
  type ResolvedIntent,
} from "./intents.js";

export interface BurrowConfig {
  agent: AgentProvider;
  sandbox: SandboxProvider;
  cwd?: string;
  burrowDir?: string;
  systemPrompt?: string;
  hooks?: Record<string, unknown>;
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
      const systemPrompt = composeSystemPrompt(
        this.config.systemPrompt,
        this.intent.resolved
      );
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

    return new Intent(
      prompt,
      {
        agent: this.config.agent.summary ?? { name: "agent" },
        sandbox: this.config.sandbox.summary ?? { name: "sandbox" },
        cwd: this.config.cwd,
        systemPrompt: !!sp,
        systemPromptLines: sp ? sp.split("\n").length : undefined,
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

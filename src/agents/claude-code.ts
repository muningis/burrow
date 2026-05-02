import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProvider, AgentRunOptions, AgentSummary } from "./agent.js";

const BUILTIN_SYSTEM_PROMPT = `
Never use the AskUserQuestion tool. When facing ambiguity or a choice between options, always pick the most reasonable default and proceed without asking.`.trim();

export interface ClaudeCodeOptions {
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

export class ClaudeCodeAgentProvider implements AgentProvider {
  readonly summary: AgentSummary;

  constructor(
    private readonly model: string,
    private readonly options: ClaudeCodeOptions = {}
  ) {
    this.summary = {
      name: "claude-code",
      model,
      permissionMode: options.permissionMode,
      allowedTools: options.allowedTools,
      maxTurns: options.maxTurns,
    };
  }

  async *run(
    prompt: string,
    options?: AgentRunOptions
  ): AsyncIterable<unknown> {
    const sandboxEnv = options?.env ?? {};
    const hasExtraEnv = Object.keys(sandboxEnv).length > 0;
    const env = hasExtraEnv
      ? (Object.fromEntries(
          [...Object.entries(process.env), ...Object.entries(sandboxEnv)].filter(
            (e): e is [string, string] => e[1] !== undefined
          )
        ) as Record<string, string>)
      : undefined;

    yield* query({
      prompt,
      options: {
        model: this.model,
        cwd: options?.cwd,
        systemPrompt: [options?.systemPrompt, BUILTIN_SYSTEM_PROMPT].filter(Boolean).join("\n\n"),
        env,
        maxTurns: this.options.maxTurns,
        allowedTools: this.options.allowedTools,
        permissionMode: this.options.permissionMode as
          | "default"
          | "acceptEdits"
          | "bypassPermissions"
          | undefined,
      },
    });
  }
}

export function claudeCode(
  model: string,
  options?: ClaudeCodeOptions
): ClaudeCodeAgentProvider {
  return new ClaudeCodeAgentProvider(model, options);
}

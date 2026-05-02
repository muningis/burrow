export interface AgentRunOptions {
  cwd?: string;
  systemPrompt?: string;
  env?: Record<string, string>;
}

export interface AgentSummary {
  name: string;
  model?: string;
  permissionMode?: string;
  allowedTools?: readonly string[];
  maxTurns?: number;
}

export interface AgentProvider {
  readonly summary?: AgentSummary;
  run(prompt: string, options?: AgentRunOptions): AsyncIterable<unknown>;
}

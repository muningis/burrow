export { Burrow, Intent, Task } from "./burrow.js";
export type {
  BurrowConfig,
  CommitStyle,
  GitConfig,
  IntentInferred,
  IntentResourceSummary,
} from "./burrow.js";
export type {
  IntentScope,
  IntentScopeKind,
  LoadedResource,
  ResolvedIntent,
} from "./intents.js";
export { burrowCacheDir, defaultScopes, installedScopes, userBurrowDir } from "./intents.js";
export { installBundle, listBundles, uninstallBundle } from "./install.js";
export type { InstalledBundle } from "./install.js";

export { claudeCode, ClaudeCodeAgentProvider } from "./agents/claude-code.js";
export type { ClaudeCodeOptions } from "./agents/claude-code.js";

export { docker, DockerSandboxProvider } from "./sandbox/docker.js";
export type { DockerSandboxConfig } from "./sandbox/docker.js";

export type { AgentProvider, AgentRunOptions, AgentSummary } from "./agents/agent.js";
export type {
  SandboxProvider,
  SandboxSummary,
  SandboxContext,
  Mount,
  Network,
  NetworkConfig,
  AllowedHost,
} from "./sandbox/sandbox.js";

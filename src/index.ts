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
export {
  burrowCacheDir,
  claudeProjectDir,
  defaultScopes,
  installedScopes,
  userBurrowDir,
  userClaudeDir,
} from "./intents.js";
export { installBundle, listBundles, uninstallBundle } from "./install.js";
export type { InstalledBundle } from "./install.js";

export { claudeCode, ClaudeCodeAgentProvider } from "./agents/claude-code.js";
export type { ClaudeCodeOptions } from "./agents/claude-code.js";

export { docker, DockerSandboxProvider } from "./sandbox/docker.js";
export type { DockerSandboxConfig } from "./sandbox/docker.js";

export type { AgentProvider, AgentRunOptions, AgentSummary } from "./agents/agent.js";
export type {
  Hook,
  HookCallback,
  HookCommand,
  HookEventName,
  HookPayload,
  HookPayloadBase,
  HooksConfig,
  IntentResolvedPayload,
  SessionEndPayload,
  SessionErrorPayload,
  SessionStartPayload,
} from "./hooks.js";
export type {
  SandboxProvider,
  SandboxSummary,
  SandboxContext,
  Mount,
  Network,
  NetworkConfig,
  AllowedHost,
  Ssh,
  SshConfig,
} from "./sandbox/sandbox.js";

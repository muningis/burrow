import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { parse as parseYaml } from "yaml";
import { Burrow, type BurrowConfig, type GitConfig } from "./burrow.js";
import { claudeCode, type ClaudeCodeOptions } from "./agents/claude-code.js";
import { docker, type DockerSandboxConfig } from "./sandbox/docker.js";
import type { AgentProvider } from "./agents/agent.js";
import type { SandboxProvider } from "./sandbox/sandbox.js";
import type {
  HookCommand,
  HookEventName,
  HooksConfig,
  HookPayload,
  Hook,
} from "./hooks.js";

interface YamlAgent {
  provider?: string;
  [key: string]: unknown;
}

interface YamlSandbox {
  provider?: string;
  [key: string]: unknown;
}

interface YamlConfig {
  agent?: YamlAgent;
  sandbox?: YamlSandbox;
  cwd?: string;
  burrowDir?: string;
  systemPrompt?: string | false | null;
  git?: GitConfig;
  watch?: boolean;
  hooks?: Record<string, unknown>;
}

const HOOK_EVENTS: readonly HookEventName[] = [
  "SessionStart",
  "IntentResolved",
  "SessionEnd",
  "SessionError",
];

function fail(msg: string, file?: string): never {
  throw new Error(`Burrow config: ${msg}${file ? ` (in ${file})` : ""}`);
}

function resolvePath(p: string, baseDir: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

function loadAgent(spec: YamlAgent | undefined, file: string): AgentProvider {
  if (!spec || typeof spec !== "object") fail("missing 'agent'", file);
  const { provider, model, ...rest } = spec;
  if (provider !== "claude-code" && provider !== "claudeCode") {
    fail(`unknown agent.provider: ${String(provider)}`, file);
  }
  if (typeof model !== "string" || !model) {
    fail("agent.model must be a non-empty string", file);
  }
  return claudeCode(model, rest as ClaudeCodeOptions);
}

function loadSandbox(
  spec: YamlSandbox | undefined,
  file: string,
  baseDir: string
): SandboxProvider {
  if (!spec || typeof spec !== "object") fail("missing 'sandbox'", file);
  const { provider, mounts, ...rest } = spec;
  if (provider !== "docker") {
    fail(`unknown sandbox.provider: ${String(provider)}`, file);
  }
  const cfg = rest as Partial<DockerSandboxConfig>;
  if (typeof cfg.imageName !== "string" || !cfg.imageName) {
    fail("sandbox.imageName must be a non-empty string", file);
  }
  if (Array.isArray(mounts)) {
    cfg.mounts = mounts.map((m) => {
      const entry = m as { source?: unknown; target?: unknown };
      if (typeof entry.source !== "string" || typeof entry.target !== "string") {
        fail("sandbox.mounts entries must have string 'source' and 'target'", file);
      }
      return {
        source: resolvePath(entry.source, baseDir),
        target: entry.target,
      };
    });
  }
  return docker(cfg as DockerSandboxConfig);
}

function loadHookEntry(entry: unknown, event: string, file: string): Hook<HookPayload> {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "command" in entry) {
    const obj = entry as HookCommand;
    if (typeof obj.command !== "string" || !obj.command) {
      fail(`hooks.${event}: entry 'command' must be a non-empty string`, file);
    }
    return obj;
  }
  fail(`hooks.${event}: entries must be a shell string or { command, args?, cwd? }`, file);
}

function loadHooks(
  raw: Record<string, unknown> | undefined,
  file: string
): HooksConfig | undefined {
  if (!raw) return undefined;
  const out: Record<string, Hook<HookPayload>[]> = {};
  for (const [event, value] of Object.entries(raw)) {
    if (!HOOK_EVENTS.includes(event as HookEventName)) {
      fail(
        `hooks.${event}: unknown event (expected one of ${HOOK_EVENTS.join(", ")})`,
        file
      );
    }
    if (value == null) continue;
    const arr = Array.isArray(value) ? value : [value];
    out[event] = arr.map((entry) => loadHookEntry(entry, event, file));
  }
  return out as HooksConfig;
}

export function loadBurrowConfig(file: string): BurrowConfig {
  if (!existsSync(file)) fail(`config file not found: ${file}`);
  const raw = readFileSync(file, "utf-8");
  let data: YamlConfig;
  try {
    data = parseYaml(raw) as YamlConfig;
  } catch (err) {
    fail(`failed to parse YAML: ${(err as Error).message}`, file);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("config must be a YAML mapping", file);
  }

  const baseDir = dirname(file);
  const agent = loadAgent(data.agent, file);
  const sandbox = loadSandbox(data.sandbox, file, baseDir);

  const cwd = data.cwd != null ? resolvePath(data.cwd, baseDir) : undefined;
  const burrowDir =
    data.burrowDir != null ? resolvePath(data.burrowDir, baseDir) : undefined;

  let systemPrompt: string | undefined;
  if (data.systemPrompt === false || data.systemPrompt === null) {
    systemPrompt = undefined;
  } else if (typeof data.systemPrompt === "string") {
    const path = resolvePath(data.systemPrompt, baseDir);
    if (!existsSync(path)) fail(`systemPrompt file not found: ${path}`, file);
    systemPrompt = readFileSync(path, "utf-8");
  } else if (data.systemPrompt === undefined) {
    const def = resolve(baseDir, "system-prompt.md");
    systemPrompt = existsSync(def) ? readFileSync(def, "utf-8") : undefined;
  } else {
    fail("systemPrompt must be a path string, false, or null", file);
  }

  return {
    agent,
    sandbox,
    cwd,
    burrowDir,
    systemPrompt,
    git: data.git,
    watch: data.watch,
    hooks: loadHooks(data.hooks, file),
  };
}

export function loadBurrow(file: string): Burrow {
  return new Burrow(loadBurrowConfig(file));
}

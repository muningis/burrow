import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
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
  cwd?: unknown;
  burrowDir?: unknown;
  systemPrompt?: string | false | null;
  git?: unknown;
  watch?: unknown;
  hooks?: unknown;
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

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

function resolvePath(p: string, baseDir: string): string {
  const expanded = expandHome(p);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
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
  if (mounts !== undefined && !Array.isArray(mounts)) {
    fail("sandbox.mounts must be an array", file);
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
  if (typeof entry === "string") {
    if (entry.trim().length === 0) {
      fail(`hooks.${event}: entry must be a non-empty shell string`, file);
    }
    return entry;
  }
  if (entry && typeof entry === "object" && "command" in entry) {
    const obj = entry as HookCommand;
    if (typeof obj.command !== "string" || obj.command.trim().length === 0) {
      fail(`hooks.${event}: entry 'command' must be a non-empty string`, file);
    }
    if (
      obj.args !== undefined &&
      (!Array.isArray(obj.args) || obj.args.some((a) => typeof a !== "string"))
    ) {
      fail(`hooks.${event}: entry 'args' must be an array of strings`, file);
    }
    if (
      obj.cwd !== undefined &&
      (typeof obj.cwd !== "string" || obj.cwd.trim().length === 0)
    ) {
      fail(`hooks.${event}: entry 'cwd' must be a non-empty string`, file);
    }
    return obj;
  }
  fail(`hooks.${event}: entries must be a shell string or { command, args?, cwd? }`, file);
}

function loadHooks(raw: unknown, file: string): HooksConfig | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    fail("hooks must be a mapping", file);
  }
  const hooks = raw as Record<string, unknown>;
  const out: Record<string, Hook<HookPayload>[]> = {};
  for (const [event, value] of Object.entries(hooks)) {
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

  if (data.cwd != null && typeof data.cwd !== "string") {
    fail("cwd must be a string", file);
  }
  if (data.burrowDir != null && typeof data.burrowDir !== "string") {
    fail("burrowDir must be a string", file);
  }
  const cwd = data.cwd != null ? resolvePath(data.cwd, baseDir) : undefined;
  const burrowDir =
    data.burrowDir != null ? resolvePath(data.burrowDir, baseDir) : undefined;

  let systemPrompt: string | undefined;
  if (data.systemPrompt === false || data.systemPrompt === null) {
    systemPrompt = undefined;
  } else if (typeof data.systemPrompt === "string") {
    if (data.systemPrompt.trim().length === 0) {
      fail("systemPrompt must be a non-empty path string, false, or null", file);
    }
    const path = resolvePath(data.systemPrompt, baseDir);
    if (!existsSync(path) || !statSync(path).isFile()) {
      fail(`systemPrompt must reference an existing file: ${path}`, file);
    }
    systemPrompt = readFileSync(path, "utf-8");
  } else if (data.systemPrompt === undefined) {
    const def = resolve(baseDir, "system-prompt.md");
    systemPrompt = existsSync(def) ? readFileSync(def, "utf-8") : undefined;
  } else {
    fail("systemPrompt must be a path string, false, or null", file);
  }

  if (data.watch != null && typeof data.watch !== "boolean") {
    fail("watch must be a boolean", file);
  }

  let git: GitConfig | undefined;
  if (data.git != null) {
    if (typeof data.git !== "object" || Array.isArray(data.git)) {
      fail("git must be a mapping", file);
    }
    const rawGit = data.git as Record<string, unknown>;
    if (rawGit.branchPattern != null && typeof rawGit.branchPattern !== "string") {
      fail("git.branchPattern must be a string", file);
    }
    if (
      rawGit.commitStyle != null &&
      rawGit.commitStyle !== "conventional" &&
      rawGit.commitStyle !== "custom"
    ) {
      fail('git.commitStyle must be "conventional" or "custom"', file);
    }
    if (rawGit.commitTemplate != null && typeof rawGit.commitTemplate !== "string") {
      fail("git.commitTemplate must be a string", file);
    }
    if (rawGit.defaultBranch != null && typeof rawGit.defaultBranch !== "string") {
      fail("git.defaultBranch must be a string", file);
    }
    git = {
      branchPattern: rawGit.branchPattern as string | undefined,
      commitStyle: rawGit.commitStyle as GitConfig["commitStyle"],
      commitTemplate: rawGit.commitTemplate as string | undefined,
      defaultBranch: rawGit.defaultBranch as string | undefined,
    };
  }

  return {
    agent,
    sandbox,
    cwd,
    burrowDir,
    systemPrompt,
    git,
    watch: data.watch as boolean | undefined,
    hooks: loadHooks(data.hooks, file),
  };
}

export function loadBurrow(file: string): Burrow {
  return new Burrow(loadBurrowConfig(file));
}

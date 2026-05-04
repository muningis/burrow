import { spawn } from "child_process";

export type HookEventName =
  | "SessionStart"
  | "IntentResolved"
  | "SessionEnd"
  | "SessionError";

export interface HookPayloadBase {
  event: HookEventName;
  prompt: string;
  cwd?: string;
}

export interface SessionStartPayload extends HookPayloadBase {
  event: "SessionStart";
}

export interface IntentResolvedPayload extends HookPayloadBase {
  event: "IntentResolved";
  intent: {
    name: string;
    type: string;
    description: string;
    scope: string;
  } | null;
  agents: string[];
  skills: string[];
  context: string[];
  docs: string[];
}

export interface SessionEndPayload extends HookPayloadBase {
  event: "SessionEnd";
  status: "success" | "error";
  summary: string;
  subtype?: string;
  cost?: number;
  finalMessage?: string;
}

export interface SessionErrorPayload extends HookPayloadBase {
  event: "SessionError";
  error: string;
}

export type HookPayload =
  | SessionStartPayload
  | IntentResolvedPayload
  | SessionEndPayload
  | SessionErrorPayload;

export type HookCallback<P extends HookPayload = HookPayload> = (
  payload: P
) => void | Promise<void>;

export interface HookCommand {
  command: string;
  args?: string[];
  cwd?: string;
}

export type Hook<P extends HookPayload = HookPayload> =
  | HookCallback<P>
  | HookCommand
  | string;

export interface HooksConfig {
  SessionStart?: Hook<SessionStartPayload> | Hook<SessionStartPayload>[];
  IntentResolved?: Hook<IntentResolvedPayload> | Hook<IntentResolvedPayload>[];
  SessionEnd?: Hook<SessionEndPayload> | Hook<SessionEndPayload>[];
  SessionError?: Hook<SessionErrorPayload> | Hook<SessionErrorPayload>[];
}

const MAX_ENV_VALUE = 4096;

function envValue(value: string): string {
  return value.length > MAX_ENV_VALUE
    ? `${value.slice(0, MAX_ENV_VALUE)}…`
    : value;
}

function payloadEnv(payload: HookPayload): Record<string, string> {
  const env: Record<string, string> = {
    BURROW_EVENT: payload.event,
    BURROW_PROMPT: envValue(payload.prompt),
  };
  if (payload.cwd) env.BURROW_CWD = payload.cwd;
  switch (payload.event) {
    case "IntentResolved":
      if (payload.intent) {
        env.BURROW_INTENT_NAME = payload.intent.name;
        env.BURROW_INTENT_TYPE = payload.intent.type;
        env.BURROW_INTENT_SCOPE = payload.intent.scope;
      }
      break;
    case "SessionEnd":
      env.BURROW_STATUS = payload.status;
      env.BURROW_SUMMARY = envValue(payload.summary);
      if (payload.subtype) env.BURROW_SUBTYPE = payload.subtype;
      if (payload.cost != null) env.BURROW_COST = String(payload.cost);
      if (payload.finalMessage) env.BURROW_FINAL_MESSAGE = envValue(payload.finalMessage);
      break;
    case "SessionError":
      env.BURROW_ERROR = envValue(payload.error);
      break;
  }
  return env;
}

const HOOK_TIMEOUT_MS = 10_000;

async function runCommand(
  hook: HookCommand | string,
  payload: HookPayload,
  defaultCwd?: string
): Promise<void> {
  const isString = typeof hook === "string";
  const cmd = isString ? hook : hook.command;
  const args = isString ? [] : hook.args ?? [];
  const cwd = (isString ? undefined : hook.cwd) ?? defaultCwd;

  await new Promise<void>((resolve) => {
    try {
      const env = Object.fromEntries(
        [...Object.entries(process.env), ...Object.entries(payloadEnv(payload))].filter(
          (e): e is [string, string] => e[1] !== undefined
        )
      );
      const proc = spawn(cmd, args, {
        cwd,
        env,
        stdio: ["pipe", "inherit", "inherit"],
        shell: isString,
      });
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        finish();
      }, HOOK_TIMEOUT_MS);
      proc.on("error", finish);
      proc.on("exit", finish);
      proc.stdin?.on("error", finish);
      proc.stdin?.end(JSON.stringify(payload));
    } catch {
      resolve();
    }
  });
}

async function runOne(
  hook: Hook,
  payload: HookPayload,
  defaultCwd?: string
): Promise<void> {
  try {
    if (typeof hook === "function") {
      await (hook as HookCallback)(payload);
    } else {
      await runCommand(hook, payload, defaultCwd);
    }
  } catch {
    // hooks are best-effort; never fail the session on a hook error
  }
}

export async function fireHook(
  config: HooksConfig | undefined,
  payload: HookPayload,
  defaultCwd?: string
): Promise<void> {
  if (!config) return;
  const entry = config[payload.event];
  if (!entry) return;
  const hooks = Array.isArray(entry) ? entry : [entry];
  for (const h of hooks) {
    await runOne(h as Hook, payload, defaultCwd);
  }
}

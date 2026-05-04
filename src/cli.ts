#!/usr/bin/env bun
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import chalk from "chalk";
import { runDoctorCli, runInitCli, runSetupCli } from "./init.js";
import { runInstallCli, runUninstallCli, runBundlesCli } from "./install.js";
import { userBurrowDir } from "./intents.js";
import { Burrow, Intent } from "./burrow.js";
import { loadBurrow } from "./config.js";
import { watchInstructions } from "./watch.js";

const CONFIG_FILENAME = "config.yaml";

// ── Helpers ───────────────────────────────────────────────────────────────────

const { dim, bold, green, red, yellow, blue, magenta, cyan } = chalk;
const CLEAR = "\r\x1b[K";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// ── Spinner ───────────────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const isTTY = process.stderr.isTTY && !process.env.CI;

function createSpinner(label: string) {
  if (!isTTY) return { update: (_: string) => {}, stop: () => {} };
  let i = 0;
  let current = label;
  const t = setInterval(() => {
    process.stderr.write(`\r${dim(`${FRAMES[i++ % FRAMES.length]} ${current}`)}`);
  }, 80);
  return {
    update: (next: string) => { current = next; },
    stop: () => { clearInterval(t); process.stderr.write(CLEAR); },
  };
}

// ── Tool formatting ───────────────────────────────────────────────────────────

function trunc(s: string, n = 80) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Tool categories ───────────────────────────────────────────────────────────

type ToolCategory = "execute" | "read" | "search" | "write" | "web" | "todo" | "agent" | "other";

const toolCategory: Record<string, ToolCategory> = {
  Bash:             "execute",
  Read:             "read",
  LS:               "read",
  NotebookRead:     "read",
  Glob:             "search",
  Grep:             "search",
  Write:            "write",
  Edit:             "write",
  MultiEdit:        "write",
  NotebookEdit:     "write",
  WebFetch:         "web",
  WebSearch:        "web",
  ToolSearch:       "search",
  TodoRead:         "todo",
  TodoWrite:        "todo",
  Task:             "agent",
  Agent:            "agent",
};

const categoryIcon: Record<ToolCategory, string> = {
  execute: "$",
  read:    "▤",
  search:  "⌕",
  write:   "✎",
  web:     "↗",
  todo:    "☐",
  agent:   "◈",
  other:   "•",
};

type Colorizer = (s: string) => string;
const categoryColor: Record<ToolCategory, Colorizer> = {
  execute: chalk.yellow,
  read:    chalk.blue,
  search:  chalk.cyan,
  write:   chalk.green,
  web:     chalk.magenta,
  todo:    chalk.magenta,
  agent:   chalk.cyan,
  other:   chalk.white,
};

const categorySpinner: Record<ToolCategory, string> = {
  execute: "running…",
  read:    "reading…",
  search:  "searching…",
  write:   "writing…",
  web:     "fetching…",
  todo:    "planning…",
  agent:   "delegating…",
  other:   "thinking…",
};

function formatTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash":       return trunc(oneLine(String(input.command ?? "")));
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookRead":
    case "NotebookEdit":
    case "LS":         return trunc(String(input.file_path ?? input.path ?? ""));
    case "Glob":       return trunc(oneLine(String(input.pattern ?? "")));
    case "Grep":       return trunc(oneLine(`${input.pattern}  ${input.path ?? "."}`));
    case "WebFetch":   return trunc(String(input.url ?? ""));
    case "WebSearch":
    case "ToolSearch": return trunc(String(input.query ?? ""));
    case "TodoWrite":  return trunc(oneLine(String(input.todos ?? "")));
    case "Task":
    case "Agent":      return trunc(oneLine(String(input.description ?? input.prompt ?? "")));
    default:           return "";
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.error(`Usage:
  burrow "<prompt>"        Run a task in the configured sandbox
  burrow query             Compose a multi-line prompt in $EDITOR (or read from stdin)
  burrow "<prompt>" --watch
                           Stay in the same agent session after the initial task and watch the PR for new review comments, auto-fix them, and merge when approved
  burrow init [dir]        Scaffold or update .burrow/ in the current (or given) directory (use --force to overwrite)
  burrow setup             Scaffold or update ~/.config/burrow/ (use --force to overwrite)
  burrow doctor            Check for updates to ~/.config/burrow/ (--local for .burrow/, --minimal for yes/no)
  burrow install <path>    Install a bundle from a local path into ~/.cache/burrow/
  burrow uninstall <name>  Remove an installed bundle
  burrow bundles           List installed bundles
  burrow --help            Show this message`);
}

const EDITOR_HEADER = `# Write your prompt below. Lines starting with '#' are ignored.
# Save and close the editor to submit, or leave empty to abort.
`;

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function stripEditorComments(s: string): string {
  return s
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

function composeMultilinePrompt(): string {
  if (!process.stdin.isTTY) {
    const piped = readStdinSync().trim();
    if (!piped) {
      console.error("No prompt received on stdin.");
      process.exit(1);
    }
    return piped;
  }

  const editor =
    process.env.VISUAL ||
    process.env.EDITOR ||
    (process.platform === "win32" ? "notepad" : "vi");

  const dir = mkdtempSync(path.join(os.tmpdir(), "burrow-query-"));
  const file = path.join(dir, "PROMPT_EDITMSG");
  writeFileSync(file, EDITOR_HEADER);

  try {
    const result = spawnSync(editor, [file], { stdio: "inherit", shell: true });
    if (result.status !== 0) {
      console.error(`Editor exited with status ${result.status}.`);
      process.exit(1);
    }

    const raw = readFileSync(file, "utf-8");
    const prompt = stripEditorComments(raw);
    if (!prompt) {
      console.error("Aborting: empty prompt.");
      process.exit(1);
    }
    return prompt;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const watchFlagIdx = args.indexOf("--watch");
  const hasWatchFlag = watchFlagIdx !== -1;
  if (hasWatchFlag) args.splice(watchFlagIdx, 1);

  const sub = args[0];

  if (sub === "--help" || sub === "-h" || sub === "help") {
    printUsage();
    return;
  }

  if (sub === "init") {
    runInitCli(args.slice(1));
    return;
  }

  if (sub === "setup") {
    runSetupCli(args.slice(1));
    return;
  }

  if (sub === "doctor") {
    runDoctorCli(args.slice(1));
    return;
  }

  if (sub === "install") {
    runInstallCli(args.slice(1));
    return;
  }

  if (sub === "uninstall") {
    runUninstallCli(args.slice(1));
    return;
  }

  if (sub === "bundles") {
    runBundlesCli();
    return;
  }

  let prompt: string;
  if (sub === "query") {
    prompt = composeMultilinePrompt();
  } else {
    prompt = args.join(" ");
    if (!prompt) {
      printUsage();
      process.exit(1);
    }
  }

  const projectConfigPath = path.join(process.cwd(), ".burrow", CONFIG_FILENAME);
  const globalConfigPath = path.join(userBurrowDir(), CONFIG_FILENAME);

  const configPath = existsSync(projectConfigPath)
    ? projectConfigPath
    : existsSync(globalConfigPath)
      ? globalConfigPath
      : null;

  if (!configPath) {
    console.error(`No config found. Tried:\n  ${projectConfigPath}\n  ${globalConfigPath}`);
    console.error('Run "burrow init" for a project config or "burrow setup" for a global one.');
    process.exit(1);
  }

  let b: Burrow;
  try {
    b = loadBurrow(configPath);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const shouldWatch = hasWatchFlag || b.watch === true;

  type Scope = "project" | "user" | "installed" | "builtin";

  const baseIntent = b.intent(prompt);
  // When --watch is set and the project has a git workflow, append the watch
  // instructions to the agent prompt so the entire watch loop runs inside one
  // session — no external polling.
  const intent: Intent =
    shouldWatch && baseIntent.inferred.git
      ? new Intent(
          `${baseIntent.prompt}\n\n${watchInstructions()}`,
          baseIntent.inferred,
          baseIntent.resolved
        )
      : baseIntent;

  const scopeMark: Record<Scope, string> = {
    project: "",
    user: dim("·user"),
    installed: dim("·installed"),
    builtin: dim("·builtin"),
  };
  const fmt = (r: { name: string; scope?: Scope }) =>
    r.scope && r.scope !== "project" ? `${r.name}${scopeMark[r.scope]}` : r.name;

  const sep = dim("─".repeat(Math.min(process.stderr.columns ?? 60, 60)));

  process.stderr.write(`${bold(cyan("● Intent"))}\n`);

  const i = intent.inferred;
  const agentLabel = i.agent.model ? `${i.agent.name} ${dim("·")} ${i.agent.model}` : i.agent.name;
  const sandboxLabel = i.sandbox.image ? `${i.sandbox.name} ${dim("·")} ${i.sandbox.image}` : i.sandbox.name;

  const rows: Array<[string, string]> = [];
  if (i.intent) {
    const scopeLabel =
      i.intent.scope && i.intent.scope !== "project" ? ` ${dim(`(${i.intent.scope})`)}` : "";
    rows.push(["kind", `${magenta(i.intent.type)} ${dim("·")} ${i.intent.name}${scopeLabel}`]);
  } else {
    rows.push(["kind", dim("(no intent matched)")]);
  }
  rows.push(["agent", magenta(agentLabel)]);
  rows.push(["sandbox", blue(sandboxLabel)]);
  if (i.cwd) rows.push(["cwd", yellow(i.cwd)]);
  if (i.systemPrompt) {
    const lines = i.systemPromptLines ? dim(` (${i.systemPromptLines} lines)`) : "";
    rows.push(["prompt", `${green("loaded")}${lines}`]);
  }
  if (i.agent.permissionMode) rows.push(["mode", green(i.agent.permissionMode)]);
  if (i.agent.allowedTools?.length) rows.push(["tools", cyan(i.agent.allowedTools.join(", "))]);
  if (i.agent.maxTurns != null) rows.push(["turns", String(i.agent.maxTurns)]);
  if (i.sandbox.network) rows.push(["network", cyan(i.sandbox.network)]);
  if (i.sandbox.mounts) rows.push(["mounts", String(i.sandbox.mounts)]);
  if (i.sandbox.envVars) rows.push(["env", `${i.sandbox.envVars} ${dim("var(s)")}`]);
  if (i.sandbox.ssh) rows.push(["ssh", green("forwarded")]);
  if (i.git) {
    const parts: string[] = [];
    if (i.git.branchPattern) parts.push(i.git.branchPattern);
    if (i.git.commitStyle) parts.push(i.git.commitStyle);
    if (i.git.defaultBranch) parts.push(`→ ${i.git.defaultBranch}`);
    rows.push(["git", cyan(parts.join(dim("  ·  ")))]);
  }
  if (i.agents.length) rows.push(["agents", cyan(i.agents.map(fmt).join(", "))]);
  if (i.skills.length) rows.push(["skills", cyan(i.skills.map(fmt).join(", "))]);
  if (i.context.length) rows.push(["context", cyan(i.context.map(fmt).join(", "))]);
  if (i.docs.length) rows.push(["docs", cyan(i.docs.map(fmt).join(", "))]);

  const labelWidth = rows.reduce((w, [l]) => Math.max(w, l.length), 0);
  for (const [label, value] of rows) {
    process.stderr.write(`  ${dim(label.padEnd(labelWidth))}  ${value}\n`);
  }

  process.stderr.write(`${sep}\n`);
  process.stderr.write(`${bold(cyan("● Work"))}\n`);

  const spinner = createSpinner("thinking…");

  for await (const message of b.task(intent).run()) {
    const msg = message as {
      type?: string;
      subtype?: string;
      message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      total_cost_usd?: number;
    };

    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "tool_use" && block.name) {
          const detail = formatTool(block.name, (block.input ?? {}) as Record<string, unknown>);
          const cat = toolCategory[block.name] ?? "other";
          const icon = categoryIcon[cat];
          const color = categoryColor[cat];
          spinner.stop();
          const head = color(`${icon} ${block.name}`);
          const line = detail ? `${head}  ${dim(detail)}` : head;
          process.stderr.write(`  ${line}\n`);
          spinner.update(categorySpinner[cat]);
        }
      }
    } else if (msg.type === "result") {
      spinner.stop();
      const cost = msg.total_cost_usd != null ? dim(` ($${msg.total_cost_usd.toFixed(4)})`) : "";
      if (msg.subtype === "success") {
        process.stderr.write(`${green("✓")} ${bold("Done")}${cost}\n`);
      } else {
        process.stderr.write(`${red("✗")} ${bold(`Failed: ${msg.subtype}`)}${cost}\n`);
        process.exit(1);
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

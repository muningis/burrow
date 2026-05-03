import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join, resolve } from "path";
import chalk from "chalk";
import { userBurrowDir } from "./intents.js";

const CONFIG_TS = `import { readFileSync } from "fs";
import { join } from "path";
import { Burrow, claudeCode, docker } from "burrow";

const systemPrompt = readFileSync(
  join(import.meta.dir, "system-prompt.md"),
  "utf-8"
);

export default new Burrow({
  agent: claudeCode("claude-opus-4-7", { permissionMode: "acceptEdits" }),
  sandbox: docker({ imageName: "burrow:local" }),
  cwd: join(import.meta.dir, ".."),
  systemPrompt,
});
`;

const GLOBAL_CONFIG_TS = `import { readFileSync } from "fs";
import { join } from "path";
import { Burrow, claudeCode, docker } from "burrow";

const systemPrompt = readFileSync(
  join(import.meta.dir, "system-prompt.md"),
  "utf-8"
);

export default new Burrow({
  agent: claudeCode("claude-opus-4-7", { permissionMode: "acceptEdits" }),
  sandbox: docker({ imageName: "burrow:local" }),
  // no cwd — uses the directory where burrow is invoked
  systemPrompt,
});
`;

const SYSTEM_PROMPT_MD = `You are an expert developer working on this project.

Keep changes minimal and focused. Prefer editing existing files over creating new ones. Do not add comments unless the intent is non-obvious from the code itself.
`;

const MEMORY_MD = `# Project memory

- Add notes here that should always be in context (architecture, conventions, gotchas).
`;

const GLOBAL_MEMORY_MD = `# Global memory

- Add notes here that apply across all projects (personal conventions, preferences, style).
`;

const GLOBAL_SYSTEM_PROMPT_MD = `You are an expert developer. Keep changes minimal and focused. Prefer editing existing files over creating new ones. Do not add comments unless the intent is non-obvious from the code itself.
`;

const SAMPLE_INTENT_MD = `---
description: Land a focused code change
when: User asks to implement, add, fix, or change code
---

## Goal

Land a focused code change that fulfills the user's request without expanding scope.

## Steps

1. Read the relevant existing files before editing.
2. Prefer editing existing files over creating new ones.
3. Keep the diff small and self-contained.
`;

const VERIFY_LOOP_SKILL_MD = `---
description: Verify loop for this project
---

Replace this body with the command(s) that should pass before any change is
considered done. The verify loop is language- and stack-agnostic — Burrow's
built-in implementation intents call this skill instead of any specific tool.

Examples:

- TypeScript: \`bun run typecheck && bun test\`
- Python: \`pytest && ruff check .\`
- Go: \`go vet ./... && go test ./...\`
- Make-based: \`make check\`

Treat any non-zero exit as a blocker. Fix and re-run the full loop until it
passes cleanly.
`;

const DOCKERFILE = `FROM oven/bun:alpine

RUN apk add --no-cache git ca-certificates openssh-client github-cli

RUN adduser -D -h /home/raccoon raccoon \\
 && mkdir -p /home/raccoon/.ssh \\
 && chown -R raccoon:raccoon /home/raccoon/.ssh \\
 && chmod 700 /home/raccoon/.ssh

USER raccoon
WORKDIR /home/raccoon/workspace
`;

const SUBDIRS = ["intents", "agents", "skills", "docs", "tasks"];

const PROJECT_GITIGNORE = `tasks/
`;

interface FileSpec {
  rel: string;
  content: string;
}

interface Scaffold {
  baseDir: string;
  label: string;
  subdirs: string[];
  files: FileSpec[];
}

function projectScaffold(cwd: string): Scaffold {
  const baseDir = join(cwd, ".burrow");
  return {
    baseDir,
    label: ".burrow",
    subdirs: SUBDIRS,
    files: [
      { rel: "config.ts", content: CONFIG_TS },
      { rel: "system-prompt.md", content: SYSTEM_PROMPT_MD },
      { rel: "memory.md", content: MEMORY_MD },
      { rel: "intents/code-write.md", content: SAMPLE_INTENT_MD },
      { rel: "skills/verify-loop.md", content: VERIFY_LOOP_SKILL_MD },
      { rel: "Dockerfile", content: DOCKERFILE },
      { rel: ".gitignore", content: PROJECT_GITIGNORE },
    ],
  };
}

function globalScaffold(): Scaffold {
  const baseDir = userBurrowDir();
  return {
    baseDir,
    label: "~/.config/burrow",
    subdirs: SUBDIRS,
    files: [
      { rel: "config.ts", content: GLOBAL_CONFIG_TS },
      { rel: "system-prompt.md", content: GLOBAL_SYSTEM_PROMPT_MD },
      { rel: "memory.md", content: GLOBAL_MEMORY_MD },
    ],
  };
}

const MANIFEST_FILE = ".burrow-manifest.json";
const MANIFEST_VERSION = 1;

interface Manifest {
  version: number;
  files: Record<string, string>;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function readManifest(baseDir: string): Manifest | null {
  const p = join(baseDir, MANIFEST_FILE);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as unknown;
    if (
      data &&
      typeof data === "object" &&
      "files" in data &&
      typeof (data as Manifest).files === "object"
    ) {
      return data as Manifest;
    }
  } catch {
    // fall through
  }
  return null;
}

function writeManifest(baseDir: string, files: Record<string, string>): void {
  const m: Manifest = { version: MANIFEST_VERSION, files };
  writeFileSync(join(baseDir, MANIFEST_FILE), JSON.stringify(m, null, 2) + "\n");
}

type FileStatus =
  | "missing"        // file doesn't exist; never written
  | "deleted"        // file removed by user after it was written
  | "up-to-date"     // disk matches current canonical
  | "outdated"       // disk matches manifest, canonical changed → safe to update
  | "modified"       // disk differs from canonical, canonical unchanged since install
  | "drift";         // disk differs from manifest AND canonical changed → conflict

interface FileCheck {
  spec: FileSpec;
  abs: string;
  status: FileStatus;
  canonicalHash: string;
  manifestHash: string | undefined;
}

function checkFile(spec: FileSpec, baseDir: string, manifest: Manifest | null): FileCheck {
  const abs = join(baseDir, spec.rel);
  const canonicalHash = sha256(spec.content);
  const manifestHash = manifest?.files[spec.rel];

  if (!existsSync(abs)) {
    return {
      spec,
      abs,
      status: manifestHash ? "deleted" : "missing",
      canonicalHash,
      manifestHash,
    };
  }

  const diskHash = sha256(readFileSync(abs, "utf-8"));
  if (diskHash === canonicalHash) {
    return { spec, abs, status: "up-to-date", canonicalHash, manifestHash };
  }
  if (manifestHash && diskHash === manifestHash) {
    return { spec, abs, status: "outdated", canonicalHash, manifestHash };
  }
  if (manifestHash && manifestHash !== canonicalHash) {
    return { spec, abs, status: "drift", canonicalHash, manifestHash };
  }
  return { spec, abs, status: "modified", canonicalHash, manifestHash };
}

function ensureDir(abs: string): boolean {
  if (existsSync(abs)) return false;
  mkdirSync(abs, { recursive: true });
  return true;
}

interface ApplyResult {
  created: string[];
  updated: string[];
  skipped: string[];
  conflicts: string[];
  forced: string[];
}

function applyScaffold(s: Scaffold, force: boolean): ApplyResult {
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  const forced: string[] = [];

  if (ensureDir(s.baseDir)) created.push(`${s.label}/`);
  for (const sub of s.subdirs) {
    if (ensureDir(join(s.baseDir, sub))) created.push(`${s.label}/${sub}/`);
  }

  const manifest = readManifest(s.baseDir);
  const newFiles: Record<string, string> = { ...(manifest?.files ?? {}) };

  for (const spec of s.files) {
    const c = checkFile(spec, s.baseDir, manifest);
    const rel = `${s.label}/${spec.rel}`;
    switch (c.status) {
      case "missing":
        writeFileSync(c.abs, spec.content);
        newFiles[spec.rel] = c.canonicalHash;
        created.push(rel);
        break;
      case "deleted":
        if (force) {
          writeFileSync(c.abs, spec.content);
          newFiles[spec.rel] = c.canonicalHash;
          forced.push(rel);
        } else {
          skipped.push(rel);
        }
        break;
      case "up-to-date":
        newFiles[spec.rel] = c.canonicalHash;
        skipped.push(rel);
        break;
      case "outdated":
        writeFileSync(c.abs, spec.content);
        newFiles[spec.rel] = c.canonicalHash;
        updated.push(rel);
        break;
      case "modified":
        if (force) {
          writeFileSync(c.abs, spec.content);
          newFiles[spec.rel] = c.canonicalHash;
          forced.push(rel);
        } else {
          skipped.push(rel);
        }
        break;
      case "drift":
        if (force) {
          writeFileSync(c.abs, spec.content);
          newFiles[spec.rel] = c.canonicalHash;
          forced.push(rel);
        } else {
          conflicts.push(rel);
        }
        break;
    }
  }

  writeManifest(s.baseDir, newFiles);
  return { created, updated, skipped, conflicts, forced };
}

interface InitResult {
  created: string[];
  skipped: string[];
  updated: string[];
  conflicts: string[];
  forced: string[];
}

export function runInit(cwd: string = process.cwd(), force = false): InitResult {
  return applyScaffold(projectScaffold(cwd), force);
}

function printApplyResult(r: ApplyResult, force: boolean): void {
  for (const c of r.created) console.log(`${chalk.green("created")} ${c}`);
  for (const u of r.updated) console.log(`${chalk.cyan("updated")} ${u}`);
  for (const f of r.forced) console.log(`${chalk.yellow("forced ")} ${f}`);
  for (const s of r.skipped) console.log(`${chalk.dim("skipped")} ${s}`);
  for (const c of r.conflicts) {
    console.log(
      `${chalk.red("conflict")} ${c} ${chalk.dim("— locally modified, update available")}`
    );
  }
  if (r.conflicts.length && !force) {
    console.log();
    console.log(
      chalk.yellow(
        `Re-run with ${chalk.bold("--force")} to overwrite locally-modified files.`
      )
    );
  }
}

export function runInitCli(args: string[]): void {
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const cwd = positional[0] ? resolve(process.cwd(), positional[0]) : process.cwd();
  const result = runInit(cwd, force);

  printApplyResult(result, force);

  if (
    result.created.length === 0 &&
    result.updated.length === 0 &&
    result.forced.length === 0 &&
    result.conflicts.length === 0
  ) {
    console.log(chalk.yellow("\nNothing to do — .burrow already up to date."));
    return;
  }

  if (result.created.length > 0) {
    console.log();
    console.log(chalk.bold("Next steps:"));
    console.log(`  1. Edit ${chalk.cyan(".burrow/system-prompt.md")} to describe your project.`);
    console.log(
      `  2. Build the sandbox image: ${chalk.cyan(
        "docker build -t burrow:local -f .burrow/Dockerfile ."
      )}`
    );
    console.log(`  3. Run a task: ${chalk.cyan('burrow "<prompt>"')}`);
  }
}

interface SetupResult extends InitResult {
  dir: string;
}

export function runSetup(force = false): SetupResult {
  const s = globalScaffold();
  const r = applyScaffold(s, force);
  return { ...r, dir: s.baseDir };
}

export function runSetupCli(args: string[] = []): void {
  const force = args.includes("--force");
  const { dir, ...result } = runSetup(force);

  printApplyResult(result, force);

  if (
    result.created.length === 0 &&
    result.updated.length === 0 &&
    result.forced.length === 0 &&
    result.conflicts.length === 0
  ) {
    console.log(chalk.yellow(`\nNothing to do — ${dir} already up to date.`));
    return;
  }

  if (result.conflicts.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (result.created.length > 0) {
    console.log();
    console.log(chalk.bold("Global burrow config created at:"), chalk.cyan(dir));
    console.log();
    console.log(chalk.bold("Next steps:"));
    console.log(`  1. Edit ${chalk.cyan("~/.config/burrow/system-prompt.md")} for your personal conventions.`);
    console.log(`  2. Edit ${chalk.cyan("~/.config/burrow/config.ts")} to set your preferred model and sandbox.`);
    console.log(`  3. Add global intents to ${chalk.cyan("~/.config/burrow/intents/")}.`);
    console.log(`  4. Run anywhere: ${chalk.cyan('burrow "<prompt>"')}`);
  }
}

interface DoctorReport {
  scope: "global" | "project";
  baseDir: string;
  exists: boolean;
  checks: FileCheck[];
}

function inspect(s: Scaffold, scope: "global" | "project"): DoctorReport {
  const exists = existsSync(s.baseDir);
  const manifest = readManifest(s.baseDir);
  const checks = s.files.map((spec) => checkFile(spec, s.baseDir, manifest));
  return { scope, baseDir: s.baseDir, exists, checks };
}

function reportHasUpdates(r: DoctorReport): boolean {
  if (!r.exists) return true;
  return r.checks.some(
    (c) =>
      c.status === "missing" ||
      c.status === "deleted" ||
      c.status === "outdated" ||
      c.status === "drift"
  );
}

function statusLabel(status: FileStatus): string {
  switch (status) {
    case "up-to-date": return chalk.green("ok");
    case "missing":    return chalk.yellow("missing");
    case "deleted":    return chalk.dim("deleted");
    case "outdated":   return chalk.cyan("outdated");
    case "modified":   return chalk.dim("customized");
    case "drift":      return chalk.red("conflict");
  }
}

function printReport(r: DoctorReport, label: string): void {
  console.log(chalk.bold(label), chalk.dim(r.baseDir));
  if (!r.exists) {
    console.log(`  ${chalk.yellow("not initialized")}`);
    return;
  }
  const labelWidth = r.checks.reduce((w, c) => Math.max(w, c.spec.rel.length), 0);
  for (const c of r.checks) {
    console.log(`  ${c.spec.rel.padEnd(labelWidth)}  ${statusLabel(c.status)}`);
  }
}

export function runDoctorCli(args: string[]): void {
  const local = args.includes("--local");
  const minimal = args.includes("--minimal");

  const reports: DoctorReport[] = [];
  if (local) {
    reports.push(inspect(projectScaffold(process.cwd()), "project"));
  } else {
    reports.push(inspect(globalScaffold(), "global"));
  }

  const hasUpdates = reports.some(reportHasUpdates);

  if (minimal) {
    console.log(hasUpdates ? "yes" : "no");
    process.exit(hasUpdates ? 1 : 0);
  }

  for (const r of reports) {
    printReport(r, r.scope === "global" ? "Global config" : "Project config");
  }

  console.log();
  if (hasUpdates) {
    const cmd = local ? "burrow init" : "burrow setup";
    console.log(chalk.yellow("Updates available."));
    console.log(`Run ${chalk.cyan(cmd)} to apply (use ${chalk.cyan("--force")} for conflicts).`);
    process.exit(1);
  } else {
    console.log(chalk.green("Up to date."));
  }
}

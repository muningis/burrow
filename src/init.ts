import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
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

const DOCKERFILE = `FROM oven/bun:alpine

RUN apk add --no-cache git ca-certificates

RUN adduser -D -h /home/raccoon raccoon
USER raccoon
WORKDIR /home/raccoon/workspace
`;

const SUBDIRS = ["intents", "agents", "skills", "docs"];

interface InitResult {
  created: string[];
  skipped: string[];
}

export function runInit(cwd: string = process.cwd()): InitResult {
  const burrowDir = join(cwd, ".burrow");
  const created: string[] = [];
  const skipped: string[] = [];

  const ensureDir = (rel: string, abs: string) => {
    if (existsSync(abs)) {
      skipped.push(`${rel}/`);
      return;
    }
    mkdirSync(abs, { recursive: true });
    created.push(`${rel}/`);
  };

  const writeIfMissing = (rel: string, abs: string, body: string) => {
    if (existsSync(abs)) {
      skipped.push(rel);
      return;
    }
    writeFileSync(abs, body);
    created.push(rel);
  };

  ensureDir(".burrow", burrowDir);
  for (const sub of SUBDIRS) {
    ensureDir(`.burrow/${sub}`, join(burrowDir, sub));
  }

  writeIfMissing(".burrow/config.ts", join(burrowDir, "config.ts"), CONFIG_TS);
  writeIfMissing(
    ".burrow/system-prompt.md",
    join(burrowDir, "system-prompt.md"),
    SYSTEM_PROMPT_MD
  );
  writeIfMissing(".burrow/memory.md", join(burrowDir, "memory.md"), MEMORY_MD);
  writeIfMissing(
    ".burrow/intents/code-write.md",
    join(burrowDir, "intents", "code-write.md"),
    SAMPLE_INTENT_MD
  );
  writeIfMissing(".burrow/Dockerfile", join(burrowDir, "Dockerfile"), DOCKERFILE);

  return { created, skipped };
}

export function runInitCli(args: string[]): void {
  const cwd = args[0] ? join(process.cwd(), args[0]) : process.cwd();
  const { created, skipped } = runInit(cwd);

  for (const c of created) console.log(`${chalk.green("created")} ${c}`);
  for (const s of skipped) console.log(`${chalk.dim("exists ")} ${s}`);

  if (created.length === 0) {
    console.log(chalk.yellow("\nNothing to do — .burrow already initialized."));
    return;
  }

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

interface SetupResult {
  dir: string;
  created: string[];
  skipped: string[];
}

export function runSetup(): SetupResult {
  const dir = userBurrowDir();
  const created: string[] = [];
  const skipped: string[] = [];

  const ensureDir = (rel: string, abs: string) => {
    if (existsSync(abs)) { skipped.push(`${rel}/`); return; }
    mkdirSync(abs, { recursive: true });
    created.push(`${rel}/`);
  };

  const writeIfMissing = (rel: string, abs: string, body: string) => {
    if (existsSync(abs)) { skipped.push(rel); return; }
    writeFileSync(abs, body);
    created.push(rel);
  };

  ensureDir("~/.config/burrow", dir);
  for (const sub of SUBDIRS) {
    ensureDir(`~/.config/burrow/${sub}`, join(dir, sub));
  }

  writeIfMissing("~/.config/burrow/config.ts", join(dir, "config.ts"), GLOBAL_CONFIG_TS);
  writeIfMissing("~/.config/burrow/system-prompt.md", join(dir, "system-prompt.md"), GLOBAL_SYSTEM_PROMPT_MD);
  writeIfMissing("~/.config/burrow/memory.md", join(dir, "memory.md"), GLOBAL_MEMORY_MD);

  return { dir, created, skipped };
}

export function runSetupCli(): void {
  const { dir, created, skipped } = runSetup();

  for (const c of created) console.log(`${chalk.green("created")} ${c}`);
  for (const s of skipped) console.log(`${chalk.dim("exists ")} ${s}`);

  if (created.length === 0) {
    console.log(chalk.yellow(`\nNothing to do — ${dir} already initialized.`));
    return;
  }

  console.log();
  console.log(chalk.bold("Global burrow config created at:"), chalk.cyan(dir));
  console.log();
  console.log(chalk.bold("Next steps:"));
  console.log(`  1. Edit ${chalk.cyan("~/.config/burrow/system-prompt.md")} for your personal conventions.`);
  console.log(`  2. Edit ${chalk.cyan("~/.config/burrow/config.ts")} to set your preferred model and sandbox.`);
  console.log(`  3. Add global intents to ${chalk.cyan("~/.config/burrow/intents/")}.`);
  console.log(`  4. Run anywhere: ${chalk.cyan('burrow "<prompt>"')}`);
}

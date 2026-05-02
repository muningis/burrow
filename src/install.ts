import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import { burrowCacheDir } from "./intents.js";

interface BurrowManifest {
  name: string;
  version?: string;
  description?: string;
}

function readManifest(dir: string): BurrowManifest {
  const p = join(dir, "burrow.json");
  if (!existsSync(p)) {
    throw new Error(`No burrow.json found in ${dir}`);
  }
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as BurrowManifest;
  } catch {
    throw new Error(`Failed to parse ${p}`);
  }
}

export function installBundle(sourcePath: string, force = false): void {
  const abs = sourcePath.startsWith("/") ? sourcePath : join(process.cwd(), sourcePath);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }

  const manifest = readManifest(abs);
  if (!manifest.name) throw new Error("burrow.json must have a 'name' field");

  const dest = join(burrowCacheDir(), manifest.name);
  if (existsSync(dest)) {
    if (!force) {
      throw new Error(`Bundle "${manifest.name}" is already installed. Use --force to reinstall.`);
    }
    rmSync(dest, { recursive: true, force: true });
  }

  mkdirSync(dest, { recursive: true });
  cpSync(abs, dest, { recursive: true });

  const ver = manifest.version ? chalk.dim(` v${manifest.version}`) : "";
  console.log(`${chalk.green("installed")} ${manifest.name}${ver} → ${dest}`);
}

export interface InstalledBundle {
  name: string;
  version?: string;
  description?: string;
  path: string;
}

export function listBundles(): InstalledBundle[] {
  const cache = burrowCacheDir();
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .map((entry) => join(cache, entry))
    .filter((p) => statSync(p).isDirectory())
    .map((p) => {
      try {
        const m = readManifest(p);
        return { name: m.name, version: m.version, description: m.description, path: p };
      } catch {
        return { name: p.split("/").pop()!, path: p };
      }
    });
}

export function uninstallBundle(name: string): void {
  const dest = join(burrowCacheDir(), name);
  if (!existsSync(dest)) {
    throw new Error(`Bundle "${name}" is not installed.`);
  }
  rmSync(dest, { recursive: true, force: true });
  console.log(`${chalk.yellow("removed")} ${name}`);
}

export function runInstallCli(args: string[]): void {
  const force = args.includes("--force");
  const paths = args.filter((a) => !a.startsWith("--"));
  if (!paths.length) {
    console.error("Usage: burrow install <path> [--force]");
    process.exit(1);
  }
  for (const p of paths) {
    try {
      installBundle(p, force);
    } catch (err) {
      console.error(chalk.red("error:"), err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}

export function runUninstallCli(args: string[]): void {
  const names = args.filter((a) => !a.startsWith("--"));
  if (!names.length) {
    console.error("Usage: burrow uninstall <name>");
    process.exit(1);
  }
  for (const name of names) {
    try {
      uninstallBundle(name);
    } catch (err) {
      console.error(chalk.red("error:"), err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}

export function runBundlesCli(): void {
  const bundles = listBundles();
  if (!bundles.length) {
    console.log(chalk.dim("No bundles installed."));
    console.log(`Install one with: ${chalk.cyan("burrow install <path>")}`);
    return;
  }
  for (const b of bundles) {
    const ver = b.version ? chalk.dim(` v${b.version}`) : "";
    const desc = b.description ? `  ${chalk.dim(b.description)}` : "";
    console.log(`  ${chalk.cyan(b.name)}${ver}${desc}`);
  }
}

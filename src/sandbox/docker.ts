import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import type {
  AllowedHost,
  Mount,
  Network,
  NetworkConfig,
  SandboxContext,
  SandboxProvider,
  SandboxSummary,
} from "./sandbox.js";

const execFileAsync = promisify(execFile);

export interface DockerSandboxConfig {
  imageName: string;
  mounts?: Mount[];
  env?: Record<string, string | boolean | number>;
  network?: Network;
}

function expandPath(p: string): string {
  return p.startsWith("~/") ? os.homedir() + p.slice(1) : p;
}

function normalizeEnv(
  env: Record<string, string | boolean | number>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, String(v)])
  );
}

function normalizeNetwork(network?: Network): NetworkConfig {
  if (!network) return {};
  if (typeof network === "string") return { mode: network };
  return network;
}

function formatAllowedHost(entry: AllowedHost | string): string {
  if (typeof entry === "string") {
    if (!entry.includes(":")) {
      throw new Error(
        `allowedHosts string entries must be "host:ip" (got "${entry}")`
      );
    }
    return entry;
  }
  return `${entry.host}:${entry.ip}`;
}

function networkArgs(network: NetworkConfig): string[] {
  const args: string[] = [];
  if (network.mode) args.push("--network", network.mode);
  for (const entry of network.allowedHosts ?? []) {
    args.push("--add-host", formatAllowedHost(entry));
  }
  for (const dns of network.dns ?? []) {
    args.push("--dns", dns);
  }
  return args;
}

async function cli(...args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", args);
    return stdout.trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(e.stderr?.trim() || e.message || `docker ${args[0]} failed`);
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  private containerName?: string;
  readonly summary: SandboxSummary;

  constructor(private readonly config: DockerSandboxConfig) {
    const network = normalizeNetwork(config.network);
    this.summary = {
      name: "docker",
      image: config.imageName,
      network: network.mode,
      mounts: config.mounts?.length ?? 0,
      envVars: Object.keys(config.env ?? {}).length,
    };
  }

  async start(): Promise<SandboxContext> {
    this.containerName = `burrow-${Date.now()}`;
    const env = normalizeEnv(this.config.env ?? {});
    const network = normalizeNetwork(this.config.network);

    await cli(
      "run", "-d",
      "--name", this.containerName,
      ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
      ...(this.config.mounts ?? []).flatMap((m) => [
        "--mount",
        `type=bind,source=${expandPath(m.source)},target=${m.target}`,
      ]),
      ...networkArgs(network),
      this.config.imageName,
      "sleep", "infinity",
    );

    return { env, containerId: this.containerName };
  }

  async stop(): Promise<void> {
    if (!this.containerName) return;
    const name = this.containerName;
    this.containerName = undefined;
    await cli("stop", name).catch(() => {});
    await cli("rm", name).catch(() => {});
  }
}

export function docker(config: DockerSandboxConfig): DockerSandboxProvider {
  return new DockerSandboxProvider(config);
}

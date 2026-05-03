import { execFile } from "child_process";
import { existsSync } from "fs";
import os from "os";
import { promisify } from "util";
import type {
  AllowedHost,
  Mount,
  Network,
  NetworkConfig,
  SandboxContext,
  SandboxProvider,
  SandboxSummary,
  Ssh,
  SshConfig,
} from "./sandbox.js";

const execFileAsync = promisify(execFile);

const DOCKER_DESKTOP_SSH_SOCK = "/run/host-services/ssh-auth.sock";

export interface DockerSandboxConfig {
  imageName: string;
  mounts?: Mount[];
  env?: Record<string, string | boolean | number>;
  network?: Network;
  ssh?: Ssh;
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

function normalizeSsh(ssh?: Ssh): SshConfig | null {
  if (ssh === undefined || ssh === false) return null;
  if (ssh === true) return {};
  return ssh;
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

interface SshRuntime {
  args: string[];
  env: Record<string, string>;
  socketSource: string | null;
}

function sshAgentSocket(): { source: string; target: string } | null {
  if (process.platform === "darwin") {
    // Docker on macOS runs inside a VM (Docker Desktop or Colima). existsSync
    // would check the host filesystem, but Docker's daemon only sees the VM's
    // filesystem. Return DOCKER_DESKTOP_SSH_SOCK unconditionally; a missing
    // socket produces a "bind source path does not exist" error that the
    // caller's catch block turns into actionable guidance.
    return { source: DOCKER_DESKTOP_SSH_SOCK, target: DOCKER_DESKTOP_SSH_SOCK };
  }
  const sock = process.env.SSH_AUTH_SOCK;
  if (!sock || !existsSync(sock)) return null;
  return { source: sock, target: "/run/ssh-agent.sock" };
}

function sshArgs(ssh: SshConfig): SshRuntime {
  const args: string[] = [];
  const env: Record<string, string> = {};
  const containerHome = ssh.containerHome ?? "/home/raccoon";
  const containerSshDir = `${containerHome}/.ssh`;
  let socketSource: string | null = null;

  if (ssh.agent !== false) {
    const sock = sshAgentSocket();
    if (!sock) {
      throw new Error(
        "ssh.agent is enabled but SSH_AUTH_SOCK is not set or does not exist. Start an ssh-agent or set ssh.agent: false."
      );
    }
    socketSource = sock.source;
    args.push(
      "--mount",
      `type=bind,source=${sock.source},target=${sock.target}`
    );
    env.SSH_AUTH_SOCK = sock.target;
  }

  const hostDir = expandPath(ssh.hostDir ?? "~/.ssh");

  const fileMount = (name: string, override: boolean | string | undefined, defaultOn: boolean) => {
    if (override === false) return;
    const enabled = override === undefined ? defaultOn : true;
    if (!enabled) return;
    const source =
      typeof override === "string" ? expandPath(override) : `${hostDir}/${name}`;
    if (!existsSync(source)) {
      if (typeof override === "string") {
        throw new Error(`ssh.${name}: file not found at ${source}`);
      }
      return;
    }
    args.push(
      "--mount",
      `type=bind,source=${source},target=${containerSshDir}/${name},readonly`
    );
  };

  fileMount("known_hosts", ssh.knownHosts, true);
  fileMount("config", ssh.config, false);

  return { args, env, socketSource };
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
      ssh: normalizeSsh(config.ssh) !== null,
    };
  }

  async start(): Promise<SandboxContext> {
    this.containerName = `burrow-${Date.now()}`;
    const env = normalizeEnv(this.config.env ?? {});
    const network = normalizeNetwork(this.config.network);
    const ssh = normalizeSsh(this.config.ssh);
    const sshRuntime = ssh ? sshArgs(ssh) : null;

    if (sshRuntime) Object.assign(env, sshRuntime.env);

    try {
      await cli(
        "run", "-d",
        "--name", this.containerName,
        ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
        ...(this.config.mounts ?? []).flatMap((m) => [
          "--mount",
          `type=bind,source=${expandPath(m.source)},target=${m.target}`,
        ]),
        ...(sshRuntime?.args ?? []),
        ...networkArgs(network),
        this.config.imageName,
        "sleep", "infinity",
      );
    } catch (err) {
      const errMsg = (err as Error).message ?? "";
      if (
        sshRuntime?.socketSource &&
        errMsg.includes("bind source path does not exist") &&
        errMsg.includes(sshRuntime.socketSource)
      ) {
        throw new Error(
          "ssh.agent is enabled but the SSH agent socket is not available inside the Docker VM.\n" +
          "  • Docker Desktop: should work automatically\n" +
          "  • Colima: restart with `colima start --ssh-agent`\n" +
          "  • Other runtimes: ensure the SSH agent socket is exposed inside the VM\n" +
          "To skip agent forwarding set: ssh: { agent: false }"
        );
      }
      throw err;
    }

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

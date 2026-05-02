export interface Mount {
  source: string;
  target: string;
}

export interface AllowedHost {
  host: string;
  ip: string;
}

export interface NetworkConfig {
  mode?: "none" | "bridge" | "host" | string;
  allowedHosts?: Array<AllowedHost | string>;
  dns?: string[];
}

export type Network = string | NetworkConfig;

export interface SshConfig {
  /** Forward the host SSH agent into the container (sets SSH_AUTH_SOCK). Default: true. */
  agent?: boolean;
  /** Mount the host's ~/.ssh/known_hosts (read-only). Pass a path to use a custom file. Default: true. */
  knownHosts?: boolean | string;
  /** Mount the host's ~/.ssh/config (read-only). Pass a path to use a custom file. Default: false. */
  config?: boolean | string;
  /** Path to the ~/.ssh dir on the host. Default: "~/.ssh". */
  hostDir?: string;
  /** Container user's home directory. Default: "/home/raccoon". */
  containerHome?: string;
}

export type Ssh = boolean | SshConfig;

export interface SandboxContext {
  env: Record<string, string>;
  containerId?: string;
}

export interface SandboxSummary {
  name: string;
  image?: string;
  network?: string;
  mounts?: number;
  envVars?: number;
  ssh?: boolean;
}

export interface SandboxProvider {
  readonly summary?: SandboxSummary;
  start(): Promise<SandboxContext>;
  stop(): Promise<void>;
}

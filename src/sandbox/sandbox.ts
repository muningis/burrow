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
}

export interface SandboxProvider {
  readonly summary?: SandboxSummary;
  start(): Promise<SandboxContext>;
  stop(): Promise<void>;
}

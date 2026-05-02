# Configuration

A Burrow project is configured by `.burrow/config.ts`. The file must default-export a
`Burrow` instance:

```typescript
import { Burrow, claudeCode, docker } from "burrow";

export default new Burrow({ /* … */ });
```

The full constructor signature:

```typescript
new Burrow({
  agent,         // AgentProvider — e.g. claudeCode(...)
  sandbox,       // SandboxProvider — e.g. docker(...)
  cwd,           // optional — working directory the agent runs in
  burrowDir,     // optional — override .burrow/ location
  systemPrompt,  // optional — base system prompt sent to the agent
  git,           // optional — Git workflow configuration
});
```

The rest of this document lists every field accepted by the built-in providers and
the optional sub-configs.

## `agent`

```typescript
claudeCode("claude-opus-4-7", {
  effort: "high",
  maxTurns: 50,
  allowedTools: ["Read", "Edit", "Bash"],
  permissionMode: "acceptEdits",
});
```

| Field            | Type                                                      | Default     | Description                                                                                                              |
| ---------------- | --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `model`          | `string` (positional)                                     | —           | Required. Claude model identifier (e.g. `claude-opus-4-7`).                                                              |
| `effort`         | `"low" \| "medium" \| "high" \| "xhigh" \| "max"`         | unset       | Reasoning effort hint passed to the model.                                                                               |
| `maxTurns`       | `number`                                                  | unset       | Hard cap on agent turns per task. Useful as a fail-safe.                                                                 |
| `allowedTools`   | `string[]`                                                | unset (all) | Whitelist of tool names the agent may call (e.g. `["Read", "Edit", "Bash"]`).                                            |
| `permissionMode` | `"default" \| "acceptEdits" \| "bypassPermissions"`       | `"default"` | `acceptEdits` auto-accepts file edits; `bypassPermissions` skips all confirmation prompts.                               |

## `sandbox`

```typescript
docker({
  imageName: "burrow:local",
  mounts: [{ source: "./data", target: "/home/raccoon/workspace/data" }],
  env: { DEBUG: true },
  network: "bridge",
  ssh: true,
});
```

| Field       | Type                                              | Default | Description                                                                       |
| ----------- | ------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `imageName` | `string`                                          | —       | Required. Docker image tag to run (e.g. `burrow:local`).                          |
| `mounts`    | `Mount[]`                                         | `[]`    | Bind-mounts from host to container. See [Mount](#mount).                          |
| `env`       | `Record<string, string \| number \| boolean>`     | `{}`    | Environment variables passed to the container. Values are stringified.            |
| `network`   | `string \| NetworkConfig`                         | unset   | Docker network mode or detailed config. See [Network](#network).                  |
| `ssh`       | `boolean \| SshConfig`                            | unset   | Forward host SSH credentials so the agent can `git push` and pull. See [Ssh](#ssh). |

### Mount

```typescript
{ source: "./data", target: "/home/raccoon/workspace/data" }
```

| Field    | Type     | Description                                                              |
| -------- | -------- | ------------------------------------------------------------------------ |
| `source` | `string` | Path on the host. `~/` is expanded. Relative paths resolve against cwd.  |
| `target` | `string` | Absolute path inside the container.                                      |

### Network

A network can be a simple string (Docker network mode) or an object:

```typescript
network: {
  mode: "bridge",
  allowedHosts: [
    { host: "registry.npmjs.org", ip: "104.16.0.1" },
    "api.internal:10.0.0.5",
  ],
  dns: ["1.1.1.1"],
}
```

| Field          | Type                                | Description                                                                                       |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `mode`         | `"none" \| "bridge" \| "host" \| string` | Docker `--network` value. Use `"none"` for full network isolation.                            |
| `allowedHosts` | `Array<{host, ip} \| "host:ip">`    | Static host entries appended via `--add-host`. Useful when running with `mode: "none"`.            |
| `dns`          | `string[]`                          | Resolver IPs passed via `--dns`.                                                                  |

### Ssh

Forward the host's SSH agent and known hosts into the container so `git` (and any
other SSH-based tool) can authenticate against remotes such as GitHub.

`ssh: true` enables the defaults: agent forwarding on, `~/.ssh/known_hosts` mounted
read-only, `~/.ssh/config` not mounted. Pass an `SshConfig` object to customize:

```typescript
ssh: {
  agent: true,
  knownHosts: true,
  config: false,
  hostDir: "~/.ssh",
  containerHome: "/home/raccoon",
}
```

| Field           | Type                  | Default            | Description                                                                                                                           |
| --------------- | --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`         | `boolean`             | `true`             | Forward the host's SSH agent socket and set `SSH_AUTH_SOCK` in the container. On macOS tries Docker Desktop's `/run/host-services/ssh-auth.sock` first, then falls back to `$SSH_AUTH_SOCK` (Colima, Rancher Desktop, etc.). On Linux uses `$SSH_AUTH_SOCK`. |
| `knownHosts`    | `boolean \| string`   | `true`             | Mount `<hostDir>/known_hosts` read-only into `<containerHome>/.ssh/known_hosts`. Pass a path to use a custom file.                    |
| `config`        | `boolean \| string`   | `false`            | Mount `<hostDir>/config` read-only. Enable if your SSH config drives host or identity selection.                                       |
| `hostDir`       | `string`              | `"~/.ssh"`         | Source directory on the host for `knownHosts` / `config`.                                                                             |
| `containerHome` | `string`              | `"/home/raccoon"`  | Home directory of the container user. The mount target for `~/.ssh` files is `<containerHome>/.ssh/`.                                  |

**Requirements:**

- An ssh-agent must be running on the host with your key added (`ssh-add -l` to verify).
- The container image must include `openssh-client` so `git` over SSH works (the
  default Burrow Dockerfile installs it).
- The container user's home (`/home/raccoon` by default) must contain a `.ssh`
  directory with `0700` permissions. The default Burrow Dockerfile sets this up.
- On Linux, the container user must have a UID that can read the forwarded socket;
  if you customize the Dockerfile to use a different UID, align it with your host
  user or the agent forwarding will fail.

**Security:** forwarding the SSH agent grants the container access to every key in
your agent for the lifetime of the run. Only enable it for sandboxes whose code
you control.

## `git`

```typescript
git: {
  branchPattern: "feature/<slug>",
  commitStyle: "conventional",
  commitTemplate: "...",
  defaultBranch: "main",
}
```

When `git` is set, Burrow appends a "Git Workflow" section to the agent's system
prompt instructing it to branch, commit, and open a PR.

| Field            | Type                          | Default   | Description                                                                                                                  |
| ---------------- | ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `branchPattern`  | `string`                      | unset     | Pattern used for new branches. Must contain `<slug>` (e.g. `feature/<slug>`). If omitted, the slug is used directly.           |
| `commitStyle`    | `"conventional" \| "custom"`  | unset     | `conventional` injects standard `feat:` / `fix:` guidance; `custom` requires `commitTemplate`.                                |
| `commitTemplate` | `string`                      | unset     | Free-form template shown to the agent when `commitStyle` is `"custom"`.                                                       |
| `defaultBranch`  | `string`                      | `"main"`  | Base branch passed to `gh pr create`.                                                                                         |

For `gh pr create` to succeed inside the sandbox, the container needs `gh`
installed (the default Burrow Dockerfile provides it) and an authenticated session.
The simplest path is to set `GH_TOKEN` via the sandbox `env`:

```typescript
sandbox: docker({
  imageName: "burrow:local",
  ssh: true,
  env: { GH_TOKEN: process.env.GH_TOKEN ?? "" },
}),
```

Alternatively, mount your `~/.config/gh` directory read-only:

```typescript
mounts: [{ source: "~/.config/gh", target: "/home/raccoon/.config/gh" }],
```

## Top-level fields

| Field          | Type              | Description                                                                                                  |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `agent`        | `AgentProvider`   | Required. The agent that runs each task.                                                                     |
| `sandbox`      | `SandboxProvider` | Required. The sandbox the agent runs inside.                                                                 |
| `cwd`          | `string`          | Working directory passed to the agent. Usually `join(import.meta.dir, "..")` so the agent sees your project. |
| `burrowDir`    | `string`          | Override the default `<cwd>/.burrow/` location for intents and resources.                                    |
| `systemPrompt` | `string`          | Base system prompt appended ahead of intent-specific resources.                                              |
| `git`          | `GitConfig`       | See [`git`](#git).                                                                                           |

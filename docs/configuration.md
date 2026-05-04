# Configuration

A Burrow project is configured by `.burrow/config.yaml`. Burrow loads this file
when you run a task; a global fallback at `~/.config/burrow/config.yaml` is used
when no project config is present.

```yaml
agent:
  provider: claude-code
  model: claude-opus-4-7
  permissionMode: acceptEdits

sandbox:
  provider: docker
  imageName: burrow:local

cwd: ..
```

Path values (`cwd`, `burrowDir`, `systemPrompt`, `sandbox.mounts[].source`) are
resolved relative to the directory containing the YAML file, unless absolute.

## `agent`

```yaml
agent:
  provider: claude-code
  model: claude-opus-4-7
  effort: high
  maxTurns: 50
  allowedTools: [Read, Edit, Bash]
  permissionMode: acceptEdits
```

| Field            | Type                                                      | Default     | Description                                                                                                              |
| ---------------- | --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `provider`       | `"claude-code"`                                           | —           | Required. The only built-in agent provider today.                                                                        |
| `model`          | `string`                                                  | —           | Required. Claude model identifier (e.g. `claude-opus-4-7`).                                                              |
| `effort`         | `"low" \| "medium" \| "high" \| "xhigh" \| "max"`         | unset       | Reasoning effort hint passed to the model.                                                                               |
| `maxTurns`       | `number`                                                  | unset       | Hard cap on agent turns per task. Useful as a fail-safe.                                                                 |
| `allowedTools`   | `string[]`                                                | unset (all) | Whitelist of tool names the agent may call.                                                                              |
| `permissionMode` | `"default" \| "acceptEdits" \| "bypassPermissions"`       | `"default"` | `acceptEdits` auto-accepts file edits; `bypassPermissions` skips all confirmation prompts.                               |

## `sandbox`

```yaml
sandbox:
  provider: docker
  imageName: burrow:local
  mounts:
    - source: ./data
      target: /home/raccoon/workspace/data
  env:
    DEBUG: "true"
  network: bridge
  ssh: true
```

| Field       | Type                                              | Default | Description                                                                       |
| ----------- | ------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `provider`  | `"docker"`                                        | —       | Required. The only built-in sandbox provider today.                               |
| `imageName` | `string`                                          | —       | Required. Docker image tag to run (e.g. `burrow:local`).                          |
| `mounts`    | `Mount[]`                                         | `[]`    | Bind-mounts from host to container. See [Mount](#mount).                          |
| `env`       | `Record<string, string \| number \| boolean>`     | `{}`    | Environment variables passed to the container. Values are stringified.            |
| `network`   | `string \| NetworkConfig`                         | unset   | Docker network mode or detailed config. See [Network](#network).                  |
| `ssh`       | `boolean \| SshConfig`                            | unset   | Forward host SSH credentials so the agent can `git push` and pull. See [Ssh](#ssh). |

### Mount

```yaml
mounts:
  - source: ./data
    target: /home/raccoon/workspace/data
```

| Field    | Type     | Description                                                                          |
| -------- | -------- | ------------------------------------------------------------------------------------ |
| `source` | `string` | Path on the host. `~/` is expanded. Relative paths resolve against the YAML file's dir. |
| `target` | `string` | Absolute path inside the container.                                                  |

### Network

A network can be a simple string (Docker network mode) or a mapping:

```yaml
network:
  mode: bridge
  allowedHosts:
    - host: registry.npmjs.org
      ip: 104.16.0.1
    - "api.internal:10.0.0.5"
  dns: ["1.1.1.1"]
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
read-only, `~/.ssh/config` not mounted. Pass a mapping to customize:

```yaml
ssh:
  agent: true
  knownHosts: true
  config: false
  hostDir: ~/.ssh
  containerHome: /home/raccoon
```

| Field           | Type                  | Default            | Description                                                                                                                           |
| --------------- | --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`         | `boolean`             | `true`             | Forward the host's SSH agent socket and set `SSH_AUTH_SOCK` in the container. On macOS uses `/run/host-services/ssh-auth.sock`, exposed automatically by Docker Desktop and by Colima when started with `colima start --ssh-agent`. On Linux uses `$SSH_AUTH_SOCK`. |
| `knownHosts`    | `boolean \| string`   | `true`             | Mount `<hostDir>/known_hosts` read-only into `<containerHome>/.ssh/known_hosts`. Pass a path to use a custom file.                    |
| `config`        | `boolean \| string`   | `false`            | Mount `<hostDir>/config` read-only. Enable if your SSH config drives host or identity selection.                                       |
| `hostDir`       | `string`              | `"~/.ssh"`         | Source directory on the host for `knownHosts` / `config`.                                                                             |
| `containerHome` | `string`              | `"/home/raccoon"`  | Home directory of the container user. The mount target for `~/.ssh` files is `<containerHome>/.ssh/`.                                  |

**Runtime-specific setup:**

| Runtime         | Required setup                                                  |
| --------------- | --------------------------------------------------------------- |
| Docker Desktop  | Works automatically; no extra steps.                            |
| Colima          | `colima start --ssh-agent` (or add `sshAgent: true` to `~/.colima/default/colima.yaml`). |
| Rancher Desktop | Enable "Allow Docker socket" and configure SSH agent in preferences. |
| Linux (native)  | Start `ssh-agent`, add your key with `ssh-add`, ensure `$SSH_AUTH_SOCK` is set. |

**Other requirements:**

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

```yaml
git:
  branchPattern: feature/<slug>
  commitStyle: conventional
  commitTemplate: "..."
  defaultBranch: main
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

```yaml
sandbox:
  provider: docker
  imageName: burrow:local
  ssh: true
  env:
    GH_TOKEN: ${GH_TOKEN}  # only literal strings — substitute via your shell or wrapper
```

YAML does not natively expand environment variables. If you need dynamic values,
either generate the file from a template or mount `~/.config/gh` instead:

```yaml
sandbox:
  provider: docker
  imageName: burrow:local
  mounts:
    - source: ~/.config/gh
      target: /home/raccoon/.config/gh
```

## `hooks`

Hooks fire on session lifecycle events and run a shell command or external process.
Each event accepts a single entry or a list. Function callbacks are not expressible
in YAML — for callback hooks, use the programmatic API.

```yaml
hooks:
  SessionStart:
    - "echo started: $BURROW_PROMPT"
  SessionEnd:
    - command: notify-send
      args: ["burrow", "$BURROW_SUMMARY"]
```

Valid events: `SessionStart`, `IntentResolved`, `SessionEnd`, `SessionError`.

## Top-level fields

| Field          | Type              | Description                                                                                                  |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `agent`        | mapping           | Required. The agent that runs each task. See [`agent`](#agent).                                              |
| `sandbox`      | mapping           | Required. The sandbox the agent runs inside. See [`sandbox`](#sandbox).                                      |
| `cwd`          | `string`          | Working directory passed to the agent. Defaults to unset; project configs typically use `..`.                |
| `burrowDir`    | `string`          | Override the default `<cwd>/.burrow/` location for intents and resources.                                    |
| `systemPrompt` | `string \| false` | Path to a base system prompt file. Defaults to `system-prompt.md` next to the YAML if it exists; `false` disables. |
| `git`          | mapping           | See [`git`](#git).                                                                                           |
| `watch`        | `boolean`         | When `true`, every task runs in watch mode (equivalent to passing `--watch`).                                |
| `hooks`        | mapping           | See [`hooks`](#hooks).                                                                                       |

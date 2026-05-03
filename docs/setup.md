# Sandbox setup

The Burrow sandbox is just a container — by default it has no credentials, no
SSH keys, no `gh` token. The implementation intents (`CodeWrite`, `FixPr`,
`IntentCreate`) need all three to run end-to-end: they push branches, open
pull requests, and answer review threads. This page lists the host-side and
sandbox-side knobs so those flows just work.

For the full reference of every config field see
[configuration.md](./configuration.md). This page is the focused setup
checklist.

## What the implementation intents need

| Capability                      | Provided by                                          |
| ------------------------------- | ---------------------------------------------------- |
| `git fetch` / `git push` (SSH)  | Host SSH agent + `~/.ssh/known_hosts` forwarded in   |
| `gh pr create` / `gh api`       | `gh` binary in the image + `GH_TOKEN` or `~/.config/gh` mount |
| `glab` (GitLab equivalent)      | `glab` binary in the image + `GITLAB_TOKEN` env      |

## Sandbox image

Burrow ships a minimal Alpine + Bun image at `src/Dockerfile`. The default
already installs the binaries the intents reach for:

```dockerfile
FROM oven/bun:alpine

RUN apk add --no-cache git ca-certificates openssh-client github-cli

RUN adduser -D -h /home/raccoon raccoon \
 && mkdir -p /home/raccoon/.ssh \
 && chown -R raccoon:raccoon /home/raccoon/.ssh \
 && chmod 700 /home/raccoon/.ssh

USER raccoon
WORKDIR /home/raccoon/workspace
```

If you want GitLab support, add `glab` (Alpine: `apk add glab`, Debian-based:
follow the [glab install docs](https://gitlab.com/gitlab-org/cli#installation)).

Build (or rebuild) it from the project root:

```bash
docker build -t burrow:local -f src/Dockerfile .
```

## SSH agent forwarding

`ssh: true` in the sandbox config forwards the host SSH agent socket and
mounts `~/.ssh/known_hosts` read-only into the container.

```typescript
sandbox: docker({
  imageName: "burrow:local",
  ssh: true,
}),
```

Defaults: `agent` on, `knownHosts` mounted, `~/.ssh/config` not mounted. To
mount `config` too — useful when your config selects a host alias or identity:

```typescript
ssh: { agent: true, knownHosts: true, config: true },
```

### Host setup per runtime

| Runtime         | Host setup                                                       |
| --------------- | ---------------------------------------------------------------- |
| Docker Desktop  | Works automatically on macOS and Windows.                        |
| Colima          | `colima start --ssh-agent` (or set `sshAgent: true` in `~/.colima/default/colima.yaml`). |
| Rancher Desktop | Enable Docker socket and configure SSH agent in preferences.     |
| Linux (native)  | Run `ssh-agent`, `ssh-add` your key, ensure `$SSH_AUTH_SOCK` set. |

Verify with `ssh-add -l` on the host before running Burrow.

**Security:** SSH agent forwarding gives the sandbox access to every key
loaded in your agent for the duration of the run. Only enable it for
sandboxes whose code you trust.

## `gh` authentication

Two options — pick one.

### Option 1: pass through `GH_TOKEN`

Simplest. Works without copying any host config in.

```typescript
sandbox: docker({
  imageName: "burrow:local",
  ssh: true,
  env: { GH_TOKEN: process.env.GH_TOKEN ?? "" },
}),
```

Use a fine-scoped token (read+write on the target repo, plus PR scope).
Tokens persist in container env for the run, so still treat the sandbox as
trusted.

### Option 2: mount `~/.config/gh`

Reuses your existing `gh auth login` session.

```typescript
sandbox: docker({
  imageName: "burrow:local",
  ssh: true,
  mounts: [
    { source: "~/.config/gh", target: "/home/raccoon/.config/gh" },
  ],
}),
```

The mount is bind-style and writable by default — `gh` may rotate its host
key cache in there. Make it read-only if you'd rather not let the sandbox
mutate the file.

## `glab` authentication (GitLab)

Use a `GITLAB_TOKEN` env (or `GLAB_TOKEN`) and ensure `glab` is in the image.

```typescript
sandbox: docker({
  imageName: "burrow:local",
  ssh: true,
  env: {
    GITLAB_TOKEN: process.env.GITLAB_TOKEN ?? "",
  },
}),
```

## Verifying the sandbox

A quick smoke test from inside a running container:

```bash
docker run --rm -it \
  --mount type=bind,source=$SSH_AUTH_SOCK,target=/run/ssh-agent.sock \
  -e SSH_AUTH_SOCK=/run/ssh-agent.sock \
  -e GH_TOKEN=$GH_TOKEN \
  burrow:local sh -c '
    ssh-add -l && \
    ssh -T -o StrictHostKeyChecking=accept-new git@github.com; \
    gh auth status
  '
```

(Replace the bind-source on macOS Docker Desktop with
`/run/host-services/ssh-auth.sock`.)

If `ssh-add -l` lists keys, `ssh -T git@github.com` says "successfully
authenticated", and `gh auth status` reports a token, you're set.

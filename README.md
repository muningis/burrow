# Burrow

An agent orchestration and sandboxing tool. Point it at a task, it runs Claude Code inside a Docker sandbox and streams the result.

```
bun burrow -- "Implement X"
```

## Project setup

### 1. Create `.burrow/`

```bash
mkdir .burrow
```

The full layout looks like this:

```
.burrow/
├── config.ts              # Burrow config (required)
├── system-prompt.md       # base system prompt (required)
├── intents/               # named tasks Burrow can run
│   ├── ship-feature.md    #   single-file intent
│   └── refactor-module/   #   directory intent
│       ├── intent.md      #     main intent file
│       └── checklist.md   #     sub-files referenced from intent.md
├── agents/                # project-local agents
│   └── reviewer.md
└── skills/                # project-local skills
    └── run-tests.md
```

Only `config.ts` and `system-prompt.md` are required. `intents/`, `agents/`, and `skills/` are picked up automatically when present.

**`.burrow/system-prompt.md`** — what the agent is told at startup:

```markdown
You are an expert developer working on <project>. Keep changes minimal and focused.
```

**`.burrow/config.ts`** — the Burrow config:

```typescript
import { readFileSync } from "fs";
import { join } from "path";
import { Burrow, claudeCode, docker } from "burrow";

const systemPrompt = readFileSync(join(import.meta.dir, "system-prompt.md"), "utf-8");

export default new Burrow({
  agent: claudeCode("claude-opus-4-7"),
  sandbox: docker({ imageName: "burrow:local" }),
  cwd: join(import.meta.dir, ".."),
  systemPrompt,
});
```

#### Intents

An intent is a named, reusable task description. Each intent lives in `.burrow/intents/` as either:

- a single file — `.burrow/intents/<name>.md`, or
- a directory — `.burrow/intents/<name>/intent.md` plus any supporting files (checklists, snippets, examples) referenced from `intent.md`.

The intent's name is the file or directory name (`<name>`). Use the directory form when an intent needs to ship multiple files alongside it; use the single-file form for everything else.

Each intent uses YAML frontmatter to describe when it applies and what it needs:

```markdown
---
description: Ship a new user-facing feature end-to-end
when: User asks to build, add, or implement a new feature
agents: [reviewer]
skills: [run-tests]
---

## Goal

Implement the feature described by the user, then...

## Steps

1. ...
2. ...
```

Frontmatter fields:

| Field         | Required | Description                                                          |
| ------------- | -------- | -------------------------------------------------------------------- |
| `description` | yes      | One-line summary of what the intent does.                            |
| `when`        | yes      | Trigger condition — when Burrow should pick this intent.             |
| `agents`      | no       | Names of agents from `.burrow/agents/` this intent expects.          |
| `skills`      | no       | Names of skills from `.burrow/skills/` this intent expects.          |

#### Agents and skills

`.burrow/agents/` and `.burrow/skills/` hold project-local definitions referenced by intents. Each entry is a markdown file with frontmatter describing the agent or skill, plus the body containing its prompt or instructions. Names referenced from an intent's `agents` / `skills` frontmatter map directly to filenames (without the `.md` extension).

### 2. Build the `burrow:local` image

Burrow ships a base `Dockerfile` at `src/Dockerfile` — a minimal `oven/bun:alpine` image. Build it from your project root:

```bash
docker build -t burrow:local -f src/Dockerfile .
```

Extend it with whatever your project needs:

```dockerfile
FROM oven/bun:alpine

RUN apk add --no-cache git ca-certificates

# add your project's runtime dependencies here

RUN adduser -D -h /home/raccoon raccoon
USER raccoon
WORKDIR /home/raccoon/workspace
```

Rebuild whenever the `Dockerfile` changes.

## Running

```bash
bun burrow -- "Implement X"
```

For longer, multi-line prompts, use `query` to compose one in your `$EDITOR`:

```bash
burrow query
```

`burrow query` also reads from stdin when piped:

```bash
cat prompt.md | burrow query
```

Burrow:
1. Loads `.burrow/config.ts` from the current directory
2. Starts a Docker container from `burrow:local`
3. Runs the Claude Code agent with the configured prompt, model, and system prompt
4. Streams output to stdout (tool use to stderr)
5. Stops and removes the container when done

## Configuration reference

```typescript
new Burrow({
  agent: claudeCode("claude-opus-4-7", {
    effort: "high",          // low | medium | high | xhigh | max
    maxTurns: 50,
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits",
  }),
  sandbox: docker({
    imageName: "burrow:local",
    mounts: [
      { source: "./data", target: "/home/raccoon/workspace/data" },
    ],
    env: { DEBUG: true },
    network: {
      mode: "bridge",                       // "none" | "bridge" | "host" | <custom network>
      allowedHosts: [                       // resolved via --add-host
        { host: "registry.npmjs.org", ip: "104.16.0.1" },
        "api.internal:10.0.0.5",
      ],
      dns: ["1.1.1.1"],
    },
  }),
  cwd: "/path/to/project",
  systemPrompt: "...",
  git: {
    branchPattern: "feature/<slug>",  // agent creates a branch before making changes
    commitStyle: "conventional",      // "conventional" | "custom"
    commitTemplate: "...",            // used when commitStyle is "custom"
    defaultBranch: "main",            // base branch for gh pr create (default: "main")
  },
});
```

### Git workflow

When `git` is configured, Burrow injects a **Git Workflow** section into the agent's system prompt automatically. The agent will:

1. Create a branch before touching any files. If `branchPattern` is set, `<slug>` is replaced with a short kebab-case description of the task (e.g. `feature/add-login-page`). If `branchPattern` is omitted, the slug is used directly as the branch name (e.g. `add-login-page`).
2. Write commits in the requested style (`conventional` → `feat:`, `fix:`, etc.).
3. Open a pull request with `gh pr create` after the task is complete.

`gh` (the [GitHub CLI](https://cli.github.com)) must be installed and authenticated in the sandbox image for PR creation to work. Add it to your `Dockerfile`:

```dockerfile
RUN apk add --no-cache github-cli
```

Or for Debian-based images, follow the [gh installation docs](https://github.com/cli/cli/blob/trunk/docs/install_linux.md).

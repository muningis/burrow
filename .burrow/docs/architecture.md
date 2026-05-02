# Architecture

```
.burrow/config.ts        →  new Burrow({ agent, sandbox, cwd, systemPrompt })
                                  │
                                  ▼
                         Burrow.intent(prompt)
                                  │
                resolveIntent(.burrow/, prompt)   ← discovers + scores intents
                                  │
                  ┌───────────────┼────────────────┐
                  ▼               ▼                ▼
              agents/*.md    skills/*.md    memory.md + docs/*.md
                                  │
                                  ▼
                         composeSystemPrompt()    ← merged into agent run
                                  │
                                  ▼
                          Sandbox.start() → Agent.run() → Sandbox.stop()
```

Key files:

- `src/burrow.ts` — `Burrow`, `Intent`, `Task`.
- `src/intents.ts` — intent discovery, picker, resource loading, prompt composition.
- `src/agents/claude-code.ts` — Claude Code agent provider.
- `src/sandbox/docker.ts` — Docker sandbox provider.
- `src/cli.ts` — terminal UI; renders the resolved intent and loaded resources.

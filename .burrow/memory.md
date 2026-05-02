# Burrow project memory

- Burrow uses a provider pattern: `AgentProvider` and `SandboxProvider` are
  interfaces with swappable implementations. Current providers are
  `ClaudeCodeAgentProvider` and `DockerSandboxProvider`.
- `Burrow.intent(prompt)` resolves a matching intent from `.burrow/intents/`
  and pulls in its referenced agents, skills, plus shared `memory.md` and
  `docs/`. The composed system prompt is what reaches the agent at run time.
- TS uses NodeNext module resolution: imports inside `src/` reference sibling
  files with explicit `.js` extensions.

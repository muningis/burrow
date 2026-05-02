---
description: Implement, modify, or refactor code in the Burrow codebase
when: User asks to implement add build write create modify refactor extend feature
type: CodeWrite
agents: [implementer]
skills: [run-typecheck]
---

## Goal

Land a focused code change in Burrow that fulfills the user's request without
expanding scope.

## Steps

1. Read the relevant existing files before editing.
2. Prefer editing existing files over creating new ones.
3. Keep the diff small and self-contained.
4. Run `bun run typecheck` before reporting done.

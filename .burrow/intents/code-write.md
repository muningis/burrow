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

## Working environment

Always work in a git worktree dedicated to the task — never mutate the user's
checked-out tree. Before starting:

1. Fetch the default branch from origin without touching the user's checked-out
   tree (`git fetch origin <default-branch>`).
2. Create the task branch from `origin/<default-branch>` and the worktree from
   that commit
   (`git worktree add ../.burrow-worktrees/<slug> -b <branch> origin/<default-branch>`).
3. All edits, builds, and the eventual commit happen inside that worktree.

## Steps

1. Read the relevant existing files before editing.
2. Prefer editing existing files over creating new ones.
3. Keep the diff small and self-contained.
4. Run `bun run typecheck` before reporting done.

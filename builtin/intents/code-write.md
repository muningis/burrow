---
description: Land a focused code change end-to-end (red → green → verify → PR)
when: User asks to implement add build write create modify refactor extend feature
type: CodeWrite
agents: [implementer]
skills: [verify-loop]
---

## Goal

Land a focused code change that fulfills the user's request without expanding
scope, then ship it as a pull or merge request.

## Flow

This intent has four phases. Treat them as ordered — never skip ahead.

### 1. Red (optional)

Decide whether tests should be written first. Pick the simplest answer:

- If the user explicitly asks for tests, or the change is a bugfix tied to
  observable behavior, write a failing test that captures the desired
  behavior. Commit it (or stage it as a temporary file) before implementing.
- For pure refactors, formatting, infra plumbing, or changes with no
  externally observable behavior, skip Red.

If you skip Red, briefly state why in the final report.

### 2. Green

Implement the smallest change that satisfies the request and turns any Red
test green.

1. Read the relevant existing files before editing.
2. Prefer editing existing files over creating new ones.
3. Keep the diff small and self-contained.

### 3. Verify Loop

Run the project's `verify-loop` skill. The loop is configurable per project —
do not assume a specific tool. Iterate until it passes.

### 4. Ship

Follow the Git Workflow section of the system prompt:

1. Commit the change.
2. Push the branch.
3. Open a pull request (or merge request) against the default branch.

The task is not done until the PR is open.

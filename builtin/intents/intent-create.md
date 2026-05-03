---
description: Author a new Burrow intent under .burrow/intents/
when: User asks to add create author scaffold define register a new intent intents
type: IntentCreate
agents: [implementer]
skills: [verify-loop]
---

## Goal

Add a well-formed intent under `.burrow/intents/` that the resolver in
`src/intents.ts` can discover and pick, then ship it as a PR/MR.

## Flow

This intent has five phases. Treat them as ordered — never skip ahead.

### 1. Inputs to confirm

- Intent name (kebab-case, becomes the filename or directory name).
- One-line `description` of what the intent does.
- `when` trigger phrase — the natural-language condition that should select
  this intent over the others.
- Whether the intent needs supporting files (use the directory form) or fits
  in a single file.
- Which existing `.burrow/agents/` and `.burrow/skills/` it should pull in.

### 2. Red (optional)

Skip Red unless the user explicitly asks for tests around intent resolution.
Authoring an intent is a content change, not a behavioral one.

### 3. Green

1. Pick the layout:
   - Single file → `.burrow/intents/<name>.md`.
   - Directory → `.burrow/intents/<name>/intent.md` plus any sibling files
     referenced from `intent.md`.
2. Skim the other files in `.burrow/intents/` so the new intent's tone,
   structure, and section headings match.
3. Write the frontmatter with `description`, `when`, `type` (PascalCase of
   the name), and any `agents` / `skills` arrays. Reference only agents and
   skills that already exist in scope.
4. Choose `when` keywords that are distinctive — `pickIntent` in
   `src/intents.ts` scores intents by counting unique tokens (>3 chars, minus
   a stopword list) from `when` that appear in the user's prompt. Avoid
   colliding with the trigger words of existing intents unless the new intent
   should genuinely outrank them.
5. Body: keep it short. A `## Goal` paragraph and a numbered `## Steps` list
   is the established shape. Do not duplicate guidance already in the project
   system prompt or referenced agents.
6. If new agents or skills are required, stop and surface that — creating
   those is out of scope for this intent.

### 4. Verify Loop

Run the project's `verify-loop` skill. For an intent-only change the loop
typically only validates the surrounding project (typecheck, lint), but run
it anyway.

### 5. Ship

Follow the Git Workflow section of the system prompt: commit, push, open a
pull (or merge) request.

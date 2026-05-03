---
description: Address unresolved review comments on a pull or merge request
when: User asks to resolve unresolved comment threads on a pending pull or merge request, or to address outstanding review feedback
type: FixPr
agents: [implementer]
skills: [verify-loop]
---

## Goal

Fix every unresolved review comment on the referenced pull or merge request,
landing the smallest change per thread without expanding scope.

## Flow

This intent has four phases. Treat them as ordered — never skip ahead. The PR
or MR already exists, so this flow ends at `git push`; do not open a new one.

### 1. Discover unresolved threads

Detect the platform from the user's wording: "PR" → GitHub via `gh`, "MR" →
GitLab via `glab`. If ambiguous, infer from the current repo's `origin` remote.

- GitHub: fetch `reviewThreads` via `gh api graphql` with a query for
  `repository.pullRequest(number: <n>) { reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first: 100) { nodes { path line author { login } body } } } } }`,
  paginating until `hasNextPage` is false. Keep threads where `isResolved` is
  false. Embedded `comments` carry file/line context already.
- GitLab: `glab api --paginate projects/:id/merge_requests/<n>/discussions` and
  keep entries where `resolvable` is true and `resolved` is false.

### 2. Red (optional)

If a comment describes a defect that should be guarded by a test, add a
failing test for it before implementing the fix. Otherwise skip — most review
comments are about implementation quality and don't need new tests.

### 3. Green

For each unresolved thread, read the referenced file and surrounding code,
then implement the smallest change that addresses the comment.

### 4. Verify Loop

Run the project's `verify-loop` skill once all threads are handled. Iterate
until it passes.

### 5. Ship the fixes

1. Commit the changes (one logical commit per thread is fine, or a single
   squash commit — match the project's convention).
2. Push to the existing PR/MR branch.
3. Do **not** open a new PR. Do **not** mark threads resolved on the platform
   unless the user explicitly asked.
4. Report a per-thread summary: original comment, `file:line` touched, and a
   one-line description of the fix.

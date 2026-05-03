---
description: Address unresolved review comments on a pull request or merge request
when: User asks to resolve unresolved comments threads address pending merge request outstanding
type: FixPrComments
agents: [implementer]
skills: [run-typecheck]
---

# Goal

Fix every unresolved review comment on the referenced pull or merge request,
landing the smallest change per thread without expanding scope.

## Steps

1. Detect the platform from the user's wording: "PR" → GitHub via `gh`, "MR" →
   GitLab via `glab`. If ambiguous, infer from the current repo's `origin`
   remote.
2. Fetch the unresolved threads for the given number:
   - GitHub: fetch `reviewThreads` via `gh api graphql` with query for
     `repository.pullRequest(number: <n>) { reviewThreads { nodes { ... } } }`,
     keep entries where `isResolved` is false; pull inline comments via
     `gh api repos/<owner>/<repo>/pulls/<n>/comments` for file/line context.
   - GitLab: `glab api projects/:id/merge_requests/<n>/discussions` and keep
     entries where `resolvable` is true and `resolved` is false.
3. For each unresolved thread, read the referenced file and surrounding code,
   then implement the smallest change that addresses the comment.
4. Run `bun run typecheck` once all threads are handled.
5. Report a per-thread summary: the original comment, the `file:line` touched,
   and a one-line description of the fix. Do not mark threads resolved on the
   platform unless the user explicitly asked for that.

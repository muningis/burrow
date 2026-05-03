---
description: Address unresolved review comments on a pull request or merge request
when: User asks to resolve unresolved comment threads on a pending pull request or merge request, or to address outstanding review feedback
type: FixPrComments
agents: [implementer]
skills: [verify-loop]
---

# Goal

Fix every unresolved review comment on the referenced pull or merge request,
landing the smallest change per thread without expanding scope.

## Flow

This intent inherits the Red → Green → Verify → Push flow defined by the
built-in `FixPr` intent. The Burrow-specific notes:

1. Detect the platform from the user's wording: "PR" → GitHub via `gh`, "MR" →
   GitLab via `glab`. If ambiguous, infer from the current repo's `origin`
   remote.
2. Fetch the unresolved threads for the given number:
   - GitHub: fetch `reviewThreads` via `gh api graphql` with query for
     `repository.pullRequest(number: <n>) { reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first: 100) { nodes { path line author { login } body } } } } }`,
     loop until `pageInfo.hasNextPage` is false, and keep thread entries where
     `isResolved` is false. The embedded `comments` nodes already carry file/line
     context, so no separate REST call is needed.
   - GitLab: `glab api --paginate projects/:id/merge_requests/<n>/discussions`
     and keep entries where `resolvable` is true and `resolved` is false.
3. For each unresolved thread, read the referenced file and surrounding code,
   then implement the smallest change that addresses the comment.
4. Run the `verify-loop` skill once all threads are handled.
5. Commit the changes and push to the existing PR branch. Do not open a new
   PR.
6. Report a per-thread summary: the original comment, the `file:line` touched,
   and a one-line description of the fix. Do not mark threads resolved on the
   platform unless the user explicitly asked for that.

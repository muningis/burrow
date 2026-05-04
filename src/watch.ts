// When `--watch` is set, this block is appended to the agent prompt so the
// entire watch lifecycle runs inside a single agent session — no external
// polling loop. The agent uses the harness `Monitor` tool to wait for new
// unresolved review comments, fixes them in place, then resumes monitoring;
// when the PR is approved with no unresolved threads it merges and exits.

const WATCH_INSTRUCTIONS = `# Watch Mode

After completing the initial task and pushing your work to an open PR/MR, do
not exit. Stay in this same session and run the watch loop below until the PR
is merged or closed. Do not ask for confirmation between iterations — watch
mode is autonomous.

## 1. Resolve the PR/MR

Detect the platform and the number for the current branch:

- GitHub: \`gh pr view --json number,baseRefName,headRefName,url\`
- GitLab: \`glab mr view --json iid,source_branch,target_branch,web_url\`

If no PR/MR exists for the current branch, exit watch mode — there is nothing
to watch.

## 2. Start a persistent Monitor

Use the \`Monitor\` tool with \`persistent: true\` and a poll interval of 30s.
Each stdout line is a notification, so emit only the lines you would act on:
\`NEW <thread-id>\` for each newly-appeared unresolved thread, \`READY\` when
the PR is approved with zero unresolved threads, and \`DONE state=...\` when
the PR transitions to \`MERGED\` or \`CLOSED\`.

GitHub poll script template (substitute \`OWNER\`, \`REPO\`, \`NUM\`):

\`\`\`bash
prev=""
while true; do
  resp=$(gh api graphql \\
    -F owner=OWNER -F name=REPO -F number=NUM \\
    -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){state reviewDecision reviewThreads(first:100){nodes{id isResolved}}}}}' \\
    2>/dev/null) || { sleep 30; continue; }
  state=$(echo "$resp" | jq -r '.data.repository.pullRequest.state')
  decision=$(echo "$resp" | jq -r '.data.repository.pullRequest.reviewDecision // "PENDING"')
  unresolved=$(echo "$resp" | jq -r '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | .id' | sort -u)
  if [ -n "$unresolved" ]; then
    while IFS= read -r id; do
      grep -qxF "$id" <<< "$prev" || echo "NEW $id"
    done <<< "$unresolved"
  fi
  if [ "$state" = "MERGED" ] || [ "$state" = "CLOSED" ]; then
    echo "DONE state=$state"
    break
  fi
  if [ -z "$unresolved" ] && [ "$decision" = "APPROVED" ]; then
    echo "READY decision=$decision"
  fi
  prev="$unresolved"
  sleep 30
done
\`\`\`

GitLab equivalent: \`glab api projects/:id/merge_requests/<iid>/discussions\`,
filter \`resolvable && !resolved\`, plus \`glab mr view --json state\` for the
terminal sentinel.

## 3. React to events

- **\`NEW <id>\`** — at least one new unresolved thread exists.
  1. Stop the monitor with \`TaskStop\`.
  2. Fetch the thread bodies and \`path:line\` locations:
     \`gh api graphql\` for \`reviewThreads { nodes { isResolved comments { nodes { path line body author { login } } } } }\`
     (or the GitLab discussion equivalent). Infer from \`isResolved\` which
     threads still need work — only act on the unresolved ones.
  3. Apply the smallest fix per thread. Read surrounding code first.
  4. Run the project's verify-loop until it passes.
  5. Commit and push to the existing PR/MR branch. Do not open a new PR.
  6. Restart the monitor and continue waiting.

- **\`READY\`** — PR is approved with zero unresolved threads. Merge it:
  - GitHub: \`gh pr merge --squash\` (match the project's merge convention —
    \`--rebase\` or \`--merge\` if that's what the repo uses).
  - GitLab: \`glab mr merge\`.
  After the merge succeeds, the next monitor tick will emit \`DONE\` — let it.

- **\`DONE state=MERGED\`** or **\`DONE state=CLOSED\`** — exit watch mode and
  finish the session.

## 4. Stop cleanly

Always call \`TaskStop\` on the monitor before exiting. Do not leave
background polls running.
`;

export function watchInstructions(): string {
  return WATCH_INSTRUCTIONS;
}

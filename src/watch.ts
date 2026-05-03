import { execFileSync } from "child_process";
import chalk from "chalk";
import type { Burrow } from "./burrow.js";

const POLL_MS = 30_000;
const QUIET_MS = 10 * 60 * 1000;

// Omit $after default so we only pass it when paginating
const THREADS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        state
        reviewDecision
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id isResolved }
        }
      }
    }
  }
`.trim();

interface GraphQLResult {
  data: {
    repository: {
      pullRequest: {
        state: string;
        reviewDecision: string | null;
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{ id: string; isResolved: boolean }>;
        };
      };
    };
  };
}

function ghJson<T>(args: string[], cwd: string): T {
  const out = execFileSync("gh", args, { cwd, encoding: "utf-8" });
  return JSON.parse(out) as T;
}

function fetchSessionPrNumber(cwd: string): number | null {
  try {
    const { number } = ghJson<{ number: number }>(["pr", "view", "--json", "number"], cwd);
    return number;
  } catch {
    return null;
  }
}

function fetchRepoInfo(cwd: string): { owner: string; name: string } {
  const result = ghJson<{ owner: { login: string }; name: string }>(
    ["repo", "view", "--json", "owner,name"],
    cwd
  );
  return { owner: result.owner.login, name: result.name };
}

interface PrSnapshot {
  state: string;
  reviewDecision: string | null;
  allIds: Set<string>;
  unresolvedIds: Set<string>;
}

function fetchPrSnapshot(prNumber: number, owner: string, repo: string, cwd: string): PrSnapshot {
  const allIds = new Set<string>();
  const unresolvedIds = new Set<string>();
  let after: string | null = null;
  let state = "OPEN";
  let reviewDecision: string | null = null;

  for (;;) {
    const vars: string[] = [
      "-f", `query=${THREADS_QUERY}`,
      "-F", `owner=${owner}`,
      "-F", `name=${repo}`,
      "-F", `number=${prNumber}`,
    ];
    if (after) vars.push("-F", `after=${after}`);
    const result = ghJson<GraphQLResult>(["api", "graphql", ...vars], cwd);
    const pr = result.data.repository.pullRequest;
    state = pr.state;
    reviewDecision = pr.reviewDecision;

    for (const t of pr.reviewThreads.nodes) {
      allIds.add(t.id);
      if (!t.isResolved) unresolvedIds.add(t.id);
    }

    if (!pr.reviewThreads.pageInfo.hasNextPage) break;
    after = pr.reviewThreads.pageInfo.endCursor;
  }

  return { state, reviewDecision, allIds, unresolvedIds };
}

export async function watchPr(
  burrow: Burrow,
  cwd: string,
  onMessage: (msg: unknown) => void
): Promise<void> {
  const prNumber = fetchSessionPrNumber(cwd);
  if (prNumber == null) {
    process.stderr.write(`  ${chalk.dim("Watch: no PR found on current branch — skipping")}\n`);
    return;
  }

  let repoInfo: { owner: string; name: string };
  try {
    repoInfo = fetchRepoInfo(cwd);
  } catch {
    process.stderr.write(`  ${chalk.dim("Watch: unable to detect repo info — skipping")}\n`);
    return;
  }

  const { owner, name } = repoInfo;

  // Snapshot all thread IDs that exist at session start — only IDs new since here trigger fixes.
  // A transient failure here must not abort the watcher; fall back to empty so the retry loop runs.
  const seenIds = new Set<string>();
  try {
    const initial = fetchPrSnapshot(prNumber, owner, name, cwd);
    for (const id of initial.allIds) seenIds.add(id);
  } catch {
    process.stderr.write(`  ${chalk.dim("Watch: initial snapshot failed — starting from empty")}\n`);
  }

  process.stderr.write(`  ${chalk.dim(`Watching PR #${prNumber} for new review comments…`)}\n`);

  let lastActivityAt = Date.now();

  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));

    let snapshot: PrSnapshot;
    try {
      snapshot = fetchPrSnapshot(prNumber, owner, name, cwd);
    } catch {
      if (Date.now() - lastActivityAt > QUIET_MS) break;
      continue;
    }

    if (snapshot.state === "MERGED" || snapshot.state === "CLOSED") break;
    if (snapshot.reviewDecision === "APPROVED" && snapshot.unresolvedIds.size === 0) break;
    if (Date.now() - lastActivityAt > QUIET_MS) break;

    const newIds = [...snapshot.allIds].filter((id) => !seenIds.has(id));
    if (newIds.length > 0) {
      lastActivityAt = Date.now();
      for (const id of snapshot.allIds) seenIds.add(id);
    }

    const newUnresolved = newIds.filter((id) => snapshot.unresolvedIds.has(id));
    if (newUnresolved.length > 0) {
      process.stderr.write(`\n${chalk.bold(chalk.cyan("● Fix PR comments"))}\n`);
      const fixIntent = burrow.intent(`Fix unresolved review comments in PR #${prNumber}`);
      for await (const msg of burrow.task(fixIntent).run()) {
        onMessage(msg);
      }
    }
  }
}

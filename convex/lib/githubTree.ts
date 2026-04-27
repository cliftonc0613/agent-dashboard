"use node";

/**
 * githubTree.ts — atomic multi-file commit via the GitHub Trees API.
 *
 * Why Trees API instead of multiple Contents API PUTs (see github.ts pushFiles):
 * each Contents PUT advances the branch tip and triggers a Cloudflare Pages
 * webhook build. Luke writes ~6 files per design pass; sequential PUTs would
 * fire 6 redundant CF builds. The Trees flow lands all files in a single
 * commit, so CF Pages sees exactly one new commit and builds once.
 *
 * Five GitHub API calls per commit:
 *   1. GET   /repos/{owner}/{repo}/git/ref/heads/{branch}     (singular "ref")
 *   2. GET   /repos/{owner}/{repo}/git/commits/{baseSha}
 *   3. POST  /repos/{owner}/{repo}/git/trees
 *   4. POST  /repos/{owner}/{repo}/git/commits
 *   5. PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}    (plural "refs")
 *
 * Calls go through raw fetch (not githubFetch) because githubFetch requires an
 * ActionCtx for errorLog and Luke's caller in convex/agents/luke.ts does not
 * have one available at the call site for these primitive helpers — the
 * orchestrator (Plan 05-5-04) will own ctx-based error logging.
 */

import { GitHubApiError } from "./githubRetry";

export interface CommitTreeParams {
  githubToken: string;
  owner: string;
  repoName: string;
  files: Array<{ path: string; content: string }>;
  commitMessage: string;
  branch?: string;
}

export interface CommitTreeResult {
  commitSha: string;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rebel-alliance-luke",
    "Content-Type": "application/json",
  };
}

async function ghThrowIfBad(
  resp: Response,
  operation: string,
): Promise<void> {
  if (resp.status >= 200 && resp.status < 300) return;
  const bodyText = await resp.text();
  throw new GitHubApiError(
    resp.status,
    bodyText,
    `${operation} got ${resp.status}: ${bodyText.slice(0, 200)}`,
  );
}

export async function commitTree(
  p: CommitTreeParams,
): Promise<CommitTreeResult> {
  const branch = p.branch ?? "main";
  const headers = authHeaders(p.githubToken);
  const base = `https://api.github.com/repos/${p.owner}/${p.repoName}`;

  // Step 1 — GET current ref (singular "ref")
  const refResp = await fetch(`${base}/git/ref/heads/${branch}`, {
    method: "GET",
    headers,
  });
  await ghThrowIfBad(refResp, `commitTree-getRef ${p.owner}/${p.repoName}`);
  const refJson = (await refResp.json()) as { object: { sha: string } };
  const baseSha = refJson.object.sha;

  // Step 2 — GET base commit to extract its tree sha
  const commitResp = await fetch(`${base}/git/commits/${baseSha}`, {
    method: "GET",
    headers,
  });
  await ghThrowIfBad(
    commitResp,
    `commitTree-getCommit ${p.owner}/${p.repoName}@${baseSha}`,
  );
  const commitJson = (await commitResp.json()) as { tree: { sha: string } };
  const baseTreeSha = commitJson.tree.sha;

  // Step 3 — POST new tree
  const treeBody = {
    base_tree: baseTreeSha,
    tree: p.files.map((f) => ({
      path: f.path,
      mode: "100644" as const,
      type: "blob" as const,
      content: f.content,
    })),
  };
  const treeResp = await fetch(`${base}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify(treeBody),
  });
  await ghThrowIfBad(treeResp, `commitTree-createTree ${p.owner}/${p.repoName}`);
  const treeJson = (await treeResp.json()) as { sha: string };
  const newTreeSha = treeJson.sha;

  // Step 4 — POST new commit
  const newCommitBody = {
    message: p.commitMessage,
    tree: newTreeSha,
    parents: [baseSha],
  };
  const newCommitResp = await fetch(`${base}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify(newCommitBody),
  });
  await ghThrowIfBad(
    newCommitResp,
    `commitTree-createCommit ${p.owner}/${p.repoName}`,
  );
  const newCommitJson = (await newCommitResp.json()) as { sha: string };
  const newCommitSha = newCommitJson.sha;

  // Step 5 — PATCH branch ref. PATCH uses plural "refs" — distinct from GET
  // which uses singular "ref". GitHub API inconsistency, not a typo.
  const patchResp = await fetch(`${base}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: newCommitSha, force: false }),
  });
  await ghThrowIfBad(patchResp, `commitTree-updateRef ${p.owner}/${p.repoName}`);

  return { commitSha: newCommitSha };
}

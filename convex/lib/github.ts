"use node";

/**
 * github.ts — high-level GitHub operations for Chewie's steps 1 + 2.
 *
 * Every function here calls githubFetch (NOT raw fetch) so the 3-class
 * retry policy applies uniformly. Env vars are caller-provided — this
 * file is intentionally env-agnostic for unit testability.
 */

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { githubFetch, GitHubApiError } from "./githubRetry";

// --- Shared auth headers ------------------------------------------------

function authHeaders(githubToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rebel-alliance-chewie",
  };
}

// --- 1. Generate repo from template -------------------------------------

export interface GenerateRepoParams {
  ctx: ActionCtx;
  githubToken: string;
  templateRepo: string;
  owner: string;
  repoName: string;
  isPrivate: boolean;
  runId?: Id<"runs">;
  prospectId?: Id<"prospects">;
}

/**
 * generateRepoFromTemplate — POST /repos/{templateOwner}/{templateName}/generate.
 *
 * Idempotency: GitHub returns 422 with "name already exists on this account"
 * if the repo already exists. This function treats 422 as SUCCESS (returns
 * without error) — the only way it returned 422 is a prior Chewie run that
 * already created the repo, which is exactly what idempotency wants.
 *
 * Other 4xx (401, 404) are thrown as GitHubApiError so the caller sees the
 * specific failure. 5xx and 403-secondary-rate-limit are handled inside
 * githubFetch.
 */
export async function generateRepoFromTemplate(
  params: GenerateRepoParams,
): Promise<void> {
  const [templateOwner, templateName] = params.templateRepo.split("/");
  const url = `https://api.github.com/repos/${templateOwner}/${templateName}/generate`;

  const response = await githubFetch({
    ctx: params.ctx,
    runId: params.runId,
    prospectId: params.prospectId,
    operation: `generateRepoFromTemplate ${params.owner}/${params.repoName}`,
    url,
    init: {
      method: "POST",
      headers: {
        ...authHeaders(params.githubToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        owner: params.owner,
        name: params.repoName,
        private: params.isPrivate,
        include_all_branches: false,
      }),
    },
  });

  if (response.status === 201) return;
  if (response.status === 422) {
    const bodyText = await response.text();
    if (bodyText.toLowerCase().includes("already exists")) return;
    throw new GitHubApiError(
      422,
      bodyText,
      `422 on generate (not already-exists): ${bodyText.slice(0, 200)}`,
    );
  }
  const bodyText = await response.text();
  throw new GitHubApiError(
    response.status,
    bodyText,
    `generateRepoFromTemplate unexpected ${response.status}: ${bodyText.slice(0, 200)}`,
  );
}

// --- 2. Poll repo ready --------------------------------------------------

export interface PollRepoReadyParams {
  ctx: ActionCtx;
  githubToken: string;
  owner: string;
  repoName: string;
  maxAttempts?: number;
  intervalMs?: number;
  runId?: Id<"runs">;
  prospectId?: Id<"prospects">;
}

/**
 * pollRepoReady — waits until the new repo's main branch is committable
 * AND src/data/business.ts is GET-able via the Contents API.
 *
 * Why both checks? Branch-exists fires before GitHub finishes copying
 * template files. A push at that moment fails with "conflict". Waiting
 * for the template file to be readable guarantees the template's initial
 * commit has landed.
 *
 * Timeout after 20 × 2s = 40s. GitHub normally populates new repos within
 * 3-5 seconds. If polling times out, throw — the caller should fail the
 * prospect, not retry (GitHub is probably having an outage).
 */
export async function pollRepoReady(
  params: PollRepoReadyParams,
): Promise<void> {
  const maxAttempts = params.maxAttempts ?? 20;
  const intervalMs = params.intervalMs ?? 2000;
  const branchUrl = `https://api.github.com/repos/${params.owner}/${params.repoName}/branches/main`;
  const probeUrl = `https://api.github.com/repos/${params.owner}/${params.repoName}/contents/src/data/business.ts?ref=main`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const branchResp = await githubFetch({
      ctx: params.ctx,
      runId: params.runId,
      prospectId: params.prospectId,
      operation: `pollRepoReady-branch attempt ${attempt + 1}`,
      url: branchUrl,
      init: { headers: authHeaders(params.githubToken) },
    });
    if (branchResp.status === 200) {
      const probeResp = await githubFetch({
        ctx: params.ctx,
        runId: params.runId,
        prospectId: params.prospectId,
        operation: `pollRepoReady-probe attempt ${attempt + 1}`,
        url: probeUrl,
        init: { headers: authHeaders(params.githubToken) },
      });
      if (probeResp.status === 200) return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollRepoReady: ${params.owner}/${params.repoName} not ready after ${maxAttempts} attempts`,
  );
}

// --- 3. Push a single file -----------------------------------------------

export interface PushFileParams {
  ctx: ActionCtx;
  githubToken: string;
  owner: string;
  repoName: string;
  path: string;
  content: string;
  message: string;
  runId?: Id<"runs">;
  prospectId?: Id<"prospects">;
}

/**
 * pushFile — GET current sha (if exists), then PUT with content + sha.
 *
 * Re-read the sha BEFORE every PUT so we never fight a concurrent update.
 * If GET returns 404, the file doesn't exist yet — omit sha on PUT and
 * GitHub creates it. If GET returns 200, parse sha from the response JSON
 * and include it in the PUT body.
 *
 * Base64: GitHub's contents API requires base64-encoded content. Use
 * Buffer.from(content, 'utf-8').toString('base64'). No line wrapping
 * needed — GitHub accepts unwrapped base64.
 */
export async function pushFile(params: PushFileParams): Promise<void> {
  const url = `https://api.github.com/repos/${params.owner}/${params.repoName}/contents/${params.path}`;

  let sha: string | undefined = undefined;
  const getResp = await githubFetch({
    ctx: params.ctx,
    runId: params.runId,
    prospectId: params.prospectId,
    operation: `pushFile-getSha ${params.path}`,
    url: `${url}?ref=main`,
    init: { headers: authHeaders(params.githubToken) },
  });
  if (getResp.status === 200) {
    const body = (await getResp.json()) as { sha: string };
    sha = body.sha;
  } else if (getResp.status !== 404) {
    const bodyText = await getResp.text();
    throw new GitHubApiError(
      getResp.status,
      bodyText,
      `pushFile getSha ${params.path} got ${getResp.status}: ${bodyText.slice(0, 200)}`,
    );
  }

  const contentBase64 = Buffer.from(params.content, "utf-8").toString("base64");
  const putBody: Record<string, unknown> = {
    message: params.message,
    content: contentBase64,
    branch: "main",
  };
  if (sha) putBody.sha = sha;

  const putResp = await githubFetch({
    ctx: params.ctx,
    runId: params.runId,
    prospectId: params.prospectId,
    operation: `pushFile-put ${params.path}`,
    url,
    init: {
      method: "PUT",
      headers: {
        ...authHeaders(params.githubToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(putBody),
    },
  });

  if (putResp.status === 200 || putResp.status === 201) return;
  const bodyText = await putResp.text();
  throw new GitHubApiError(
    putResp.status,
    bodyText,
    `pushFile put ${params.path} got ${putResp.status}: ${bodyText.slice(0, 200)}`,
  );
}

// --- 4. Push all files sequentially --------------------------------------

export interface PushFilesParams
  extends Omit<PushFileParams, "path" | "content" | "message"> {
  files: Array<{ path: string; content: string }>;
  commitMessage: string;
}

/**
 * pushFiles — sequential iteration of pushFile for each entry in `files`.
 *
 * Sequential because each push moves the branch's tip SHA; a parallel
 * push would race. The LAST file in the array is what triggers the
 * Cloudflare Pages auto-build — chewie.ts is responsible for ordering
 * fileMap so seoContent.ts is last.
 *
 * This helper is intentionally not idempotent across the whole set:
 * resuming from a crash mid-push re-pushes files that already matched.
 * That's fine — GitHub's Contents API with matching sha is a no-op.
 */
export async function pushFiles(params: PushFilesParams): Promise<void> {
  for (const file of params.files) {
    await pushFile({
      ctx: params.ctx,
      githubToken: params.githubToken,
      owner: params.owner,
      repoName: params.repoName,
      path: file.path,
      content: file.content,
      message: `${params.commitMessage}: ${file.path}`,
      runId: params.runId,
      prospectId: params.prospectId,
    });
  }
}

// --- 5. Fetch template SHA -----------------------------------------------

export interface FetchTemplateShaParams {
  ctx: ActionCtx;
  githubToken: string;
  templateRepo: string;
  runId?: Id<"runs">;
  prospectId?: Id<"prospects">;
}

/**
 * fetchTemplateSha — GET /repos/{owner}/{name}/commits/main and return
 * the first 8 characters of the commit SHA.
 *
 * This is written to prospect.templateVersion in step 1's markBuildStep
 * extras. Used by Phase 10 to detect when a prospect's site is on a
 * stale template version.
 */
export async function fetchTemplateSha(
  params: FetchTemplateShaParams,
): Promise<string> {
  const [owner, name] = params.templateRepo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/commits/main`;
  const resp = await githubFetch({
    ctx: params.ctx,
    runId: params.runId,
    prospectId: params.prospectId,
    operation: `fetchTemplateSha ${params.templateRepo}`,
    url,
    init: { headers: authHeaders(params.githubToken) },
  });
  if (resp.status !== 200) {
    const bodyText = await resp.text();
    throw new GitHubApiError(
      resp.status,
      bodyText,
      `fetchTemplateSha ${params.templateRepo} got ${resp.status}: ${bodyText.slice(0, 200)}`,
    );
  }
  const body = (await resp.json()) as { sha: string };
  return body.sha.slice(0, 8);
}

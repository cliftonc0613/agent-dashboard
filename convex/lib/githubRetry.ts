"use node";

/**
 * githubRetry.ts — the single GitHub fetch wrapper. Distinguishes THREE
 * error classes that the Anthropic-style retry loop cannot handle:
 *
 *   (1) 403 with body including "secondary rate limit" (CHEWIE-05):
 *       Honor the `retry-after` response header. If absent, wait 60s
 *       (GitHub's documented default for secondary limits). Max 3
 *       retries. Log each retry to errorLog with severity="warning".
 *
 *   (2) 403 without the secondary-rate-limit marker:
 *       This is permission-denied — fatal. Throw GitHubApiError
 *       immediately, do NOT retry. Exponential retry here would just
 *       slow down real failures.
 *
 *   (3) 5xx (500, 502, 503, 504, 529):
 *       Transient GitHub infrastructure. Exponential backoff
 *       1s/2s/4s + 0-500ms jitter. Max 3 retries. NOT logged to
 *       errorLog — too noisy, and each request's attempt count is
 *       already captured in return value.
 *
 * Other statuses (401, 404, 409, 422) are returned to the caller — only
 * the caller knows whether "already exists" is success or failure.
 *
 * This wrapper is the SOLE fetch site for the GitHub API. Every helper
 * in convex/lib/github.ts calls githubFetch, never raw fetch.
 */

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// --- Error types ---------------------------------------------------------

export class GitHubSecondaryRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubSecondaryRateLimitError";
  }
}

export class GitHubApiError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

// --- Constants -----------------------------------------------------------

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const JITTER_MAX_MS = 500;
const RETRYABLE_5XX = new Set([500, 502, 503, 504, 529]);
const SECONDARY_RATE_LIMIT_DEFAULT_MS = 60_000;
const MAX_SECONDARY_RATE_RETRIES = 3;

// --- Public interface ----------------------------------------------------

export interface GitHubFetchParams {
  url: string;
  init: RequestInit;
  ctx: ActionCtx;
  runId?: Id<"runs">;
  prospectId?: Id<"prospects">;
  operation: string;
}

/**
 * githubFetch — drop-in fetch replacement with the 3-class retry policy.
 *
 * Returns the raw Response on non-retriable status OR on eventual success.
 * Throws GitHubSecondaryRateLimitError ONLY after max retries are
 * exhausted. Throws GitHubApiError on fatal 403 (permission denied).
 *
 * Callers must ALWAYS add `Authorization: Bearer ${GITHUB_TOKEN}`,
 * `Accept: application/vnd.github+json`, and `X-GitHub-Api-Version:
 * 2022-11-28` to init.headers. This wrapper does NOT set them — the
 * token lookup is the caller's responsibility so the wrapper stays
 * env-var-agnostic and unit-testable.
 */
export async function githubFetch(
  params: GitHubFetchParams,
): Promise<Response> {
  let rateLimitAttempts = 0;
  let fiveHundredAttempts = 0;

  while (true) {
    const response = await fetch(params.url, params.init);

    if (
      response.status < 400 ||
      response.status === 404 ||
      response.status === 401 ||
      response.status === 409 ||
      response.status === 422
    ) {
      return response;
    }

    const bodyText = await response.clone().text();

    if (
      response.status === 403 &&
      bodyText.toLowerCase().includes("secondary rate limit")
    ) {
      if (rateLimitAttempts >= MAX_SECONDARY_RATE_RETRIES) {
        throw new GitHubSecondaryRateLimitError(
          `GitHub secondary rate limit: ${MAX_SECONDARY_RATE_RETRIES} retries exhausted for ${params.operation}`,
        );
      }
      rateLimitAttempts++;

      const retryAfterHeader = response.headers.get("retry-after");
      const delayMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : SECONDARY_RATE_LIMIT_DEFAULT_MS;

      await params.ctx.runMutation(internal.errorLog.insert, {
        agentName: "chewie",
        runId: params.runId,
        prospectId: params.prospectId,
        severity: "warning",
        message: `GitHub secondary rate limit for ${params.operation}; retrying in ${delayMs}ms (attempt ${rateLimitAttempts}/${MAX_SECONDARY_RATE_RETRIES})`,
        createdAt: Date.now(),
      });

      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (response.status === 403) {
      throw new GitHubApiError(
        403,
        bodyText,
        `GitHub 403 permission denied for ${params.operation}: ${bodyText.slice(0, 200)}`,
      );
    }

    if (RETRYABLE_5XX.has(response.status)) {
      if (fiveHundredAttempts >= RETRY_DELAYS_MS.length) {
        throw new GitHubApiError(
          response.status,
          bodyText,
          `GitHub ${response.status} for ${params.operation}: retries exhausted`,
        );
      }
      const delayMs =
        RETRY_DELAYS_MS[fiveHundredAttempts] + Math.random() * JITTER_MAX_MS;
      fiveHundredAttempts++;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    return response;
  }
}

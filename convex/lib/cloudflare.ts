"use node";

/**
 * cloudflare.ts — Cloudflare Pages API helpers for Chewie's steps 3-6.
 *
 * Step 3 — createPagesProject: POST /pages/projects, 409 → GET existing
 * Step 4 — attachCustomDomain: POST /pages/projects/{name}/domains, 409 = success
 * Step 5 — pollDeploymentReady: poll /deployments every 8s, max 45 attempts
 * Step 6 — pollSslReady: poll domain API + HEAD reachability every 5s, max 30 attempts
 *
 * All network calls route through cloudflareFetch which applies 5xx exponential
 * backoff (1s/2s/4s + jitter, max 3 retries). CF has no secondary rate-limit
 * equivalent to GitHub's so the wrapper is simpler than githubFetch.
 */

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const JITTER_MAX_MS = 500;
const RETRYABLE_5XX = new Set([
  500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530,
]);

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class CloudflareApiError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string, message: string) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

// ---------------------------------------------------------------------------
// cloudflareFetch — 5xx exponential backoff (3 retries max)
// ---------------------------------------------------------------------------

export interface CloudflareFetchParams {
  url: string;
  init: RequestInit;
  operation: string;
}

export async function cloudflareFetch(
  params: CloudflareFetchParams,
): Promise<Response> {
  let fiveHundredAttempts = 0;
  while (true) {
    const response = await fetch(params.url, params.init);
    if (response.status < 500) return response;
    if (!RETRYABLE_5XX.has(response.status)) return response;
    if (fiveHundredAttempts >= RETRY_DELAYS_MS.length) {
      const bodyText = await response.text();
      throw new CloudflareApiError(
        response.status,
        bodyText,
        `Cloudflare ${response.status} for ${params.operation}: retries exhausted`,
      );
    }
    const delayMs =
      RETRY_DELAYS_MS[fiveHundredAttempts] + Math.random() * JITTER_MAX_MS;
    fiveHundredAttempts++;
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ---------------------------------------------------------------------------
// createPagesProject (Step 3)
// ---------------------------------------------------------------------------

export interface CreatePagesProjectParams {
  cfAccountId: string;
  cfApiToken: string;
  projectName: string;
  githubOwner: string;
  repoName: string;
}

export interface CreatePagesProjectResult {
  subdomain: string;
  raw: Record<string, unknown>;
}

/**
 * POST /accounts/{cfAccountId}/pages/projects
 * Configures GitHub source with build_command="npm run build" and destination_dir="dist".
 * 409 → GET the existing project and return its subdomain (idempotency for CHEWIE-02).
 */
export async function createPagesProject(
  params: CreatePagesProjectParams,
): Promise<CreatePagesProjectResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${params.cfAccountId}/pages/projects`;
  const body = {
    name: params.projectName,
    production_branch: "main",
    source: {
      type: "github",
      config: {
        owner: params.githubOwner,
        repo_name: params.repoName,
        production_branch: "main",
        deployments_enabled: true,
        pr_comments_enabled: false,
        preview_deployment_setting: "none",
      },
    },
    build_config: {
      build_command: "npm run build",
      destination_dir: "dist",
    },
  };

  const resp = await cloudflareFetch({
    operation: `createPagesProject ${params.projectName}`,
    url,
    init: {
      method: "POST",
      headers: authHeaders(params.cfApiToken),
      body: JSON.stringify(body),
    },
  });

  if (resp.status === 200 || resp.status === 201) {
    const json = (await resp.json()) as {
      result: { subdomain: string } & Record<string, unknown>;
    };
    return { subdomain: json.result.subdomain, raw: json.result };
  }

  if (resp.status === 409) {
    // Project already exists — GET it to reuse the existing subdomain.
    const getUrl = `${url}/${params.projectName}`;
    const getResp = await cloudflareFetch({
      operation: `createPagesProject-getExisting ${params.projectName}`,
      url: getUrl,
      init: {
        method: "GET",
        headers: authHeaders(params.cfApiToken),
      },
    });
    if (getResp.status !== 200) {
      const bodyText = await getResp.text();
      throw new CloudflareApiError(
        getResp.status,
        bodyText,
        `createPagesProject 409-then-GET failed ${getResp.status}: ${bodyText.slice(0, 200)}`,
      );
    }
    const json = (await getResp.json()) as {
      result: { subdomain: string } & Record<string, unknown>;
    };
    return { subdomain: json.result.subdomain, raw: json.result };
  }

  const bodyText = await resp.text();
  throw new CloudflareApiError(
    resp.status,
    bodyText,
    `createPagesProject unexpected ${resp.status}: ${bodyText.slice(0, 200)}`,
  );
}

// ---------------------------------------------------------------------------
// attachCustomDomain (Step 4)
// ---------------------------------------------------------------------------

export interface AttachCustomDomainParams {
  cfAccountId: string;
  cfApiToken: string;
  projectName: string;
  domainName: string;
}

/**
 * POST /accounts/{cfAccountId}/pages/projects/{projectName}/domains
 * 409 treated as success (domain already attached — idempotent).
 */
export async function attachCustomDomain(
  params: AttachCustomDomainParams,
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${params.cfAccountId}/pages/projects/${params.projectName}/domains`;
  const resp = await cloudflareFetch({
    operation: `attachCustomDomain ${params.domainName} → ${params.projectName}`,
    url,
    init: {
      method: "POST",
      headers: authHeaders(params.cfApiToken),
      body: JSON.stringify({ name: params.domainName }),
    },
  });
  if (resp.status === 200 || resp.status === 201) return;
  if (resp.status === 409) return; // already attached — success
  const bodyText = await resp.text();
  throw new CloudflareApiError(
    resp.status,
    bodyText,
    `attachCustomDomain unexpected ${resp.status}: ${bodyText.slice(0, 200)}`,
  );
}

// ---------------------------------------------------------------------------
// pollDeploymentReady (Step 5)
// ---------------------------------------------------------------------------

export interface PollDeploymentReadyParams {
  cfAccountId: string;
  cfApiToken: string;
  projectName: string;
  /** Default: 45 (~6 min at 8s intervals) */
  maxAttempts?: number;
  /** Default: 8000ms */
  intervalMs?: number;
}

export interface PollDeploymentReadyResult {
  deploymentId: string;
  url: string;
  aliases: string[];
}

/**
 * GET /accounts/{cfAccountId}/pages/projects/{projectName}/deployments
 * Polls every 8s for up to 45 attempts (~6 minutes).
 * Success: result[0].latest_stage.status === "success"
 * Throws on "failure" or "canceled" so the catch block can transition prospect to "failed".
 */
export async function pollDeploymentReady(
  params: PollDeploymentReadyParams,
): Promise<PollDeploymentReadyResult> {
  const maxAttempts = params.maxAttempts ?? 45;
  const intervalMs = params.intervalMs ?? 8000;
  const url = `https://api.cloudflare.com/client/v4/accounts/${params.cfAccountId}/pages/projects/${params.projectName}/deployments`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const resp = await cloudflareFetch({
      operation: `pollDeploymentReady ${params.projectName} attempt ${attempt + 1}`,
      url,
      init: {
        method: "GET",
        headers: authHeaders(params.cfApiToken),
      },
    });
    if (resp.status === 404) {
      // CF API is eventually consistent — project may not be visible on all
      // edge nodes immediately after creation. Treat 404 as "not ready yet"
      // for the first 5 attempts, then throw.
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      const bodyText = await resp.text();
      throw new CloudflareApiError(
        resp.status,
        bodyText,
        `pollDeploymentReady ${resp.status}: ${bodyText.slice(0, 200)}`,
      );
    }
    if (resp.status !== 200) {
      const bodyText = await resp.text();
      throw new CloudflareApiError(
        resp.status,
        bodyText,
        `pollDeploymentReady ${resp.status}: ${bodyText.slice(0, 200)}`,
      );
    }

    const json = (await resp.json()) as {
      result: Array<{
        id: string;
        url: string;
        aliases?: string[];
        latest_stage: { name: string; status: string };
      }>;
    };

    const latest = json.result[0];
    if (!latest) {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const stage = latest.latest_stage;
    if (stage.status === "success") {
      return {
        deploymentId: latest.id,
        url: latest.url,
        aliases: latest.aliases ?? [],
      };
    }
    if (stage.status === "failure" || stage.status === "canceled") {
      throw new Error(
        `CF deployment ${stage.status} at stage "${stage.name}" for ${params.projectName}`,
      );
    }
    // Still in-progress — keep polling.
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollDeploymentReady: ${params.projectName} not ready after ${maxAttempts} attempts`,
  );
}

// ---------------------------------------------------------------------------
// pollSslReady (Step 6)
// ---------------------------------------------------------------------------

export interface PollSslReadyParams {
  cfAccountId: string;
  cfApiToken: string;
  projectName: string;
  domainName: string;
  /** Default: 30 (~2.5 min at 5s intervals) */
  maxAttempts?: number;
  /** Default: 5000ms */
  intervalMs?: number;
}

/**
 * Polls BOTH:
 *   1. GET /accounts/{id}/pages/projects/{name}/domains/{domain}
 *      → result.status === "active" AND result.verification_data.status === "active"
 *   2. HEAD https://{domainName} → non-5xx response (cert issued + CF serving)
 *
 * Both conditions must be true before returning.
 * Max 30 attempts at 5s intervals (~2.5 minutes).
 */
export async function pollSslReady(params: PollSslReadyParams): Promise<void> {
  const maxAttempts = params.maxAttempts ?? 30;
  const intervalMs = params.intervalMs ?? 5000;
  const domainApiUrl = `https://api.cloudflare.com/client/v4/accounts/${params.cfAccountId}/pages/projects/${params.projectName}/domains/${params.domainName}`;
  const httpsUrl = `https://${params.domainName}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // --- CF domain API check ---
    const apiResp = await cloudflareFetch({
      operation: `pollSslReady-api ${params.domainName} attempt ${attempt + 1}`,
      url: domainApiUrl,
      init: {
        method: "GET",
        headers: authHeaders(params.cfApiToken),
      },
    });
    let apiOk = false;
    if (apiResp.status === 200) {
      const json = (await apiResp.json()) as {
        result: {
          status: string;
          verification_data?: { status: string };
        };
      };
      apiOk =
        json.result.status === "active" &&
        json.result.verification_data?.status === "active";
    }

    // --- HEAD reachability check ---
    let httpOk = false;
    try {
      const headResp = await fetch(httpsUrl, { method: "HEAD" });
      httpOk = headResp.status < 500;
    } catch {
      httpOk = false;
    }

    if (apiOk && httpOk) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollSslReady: ${params.domainName} not reachable with active cert after ${maxAttempts} attempts`,
  );
}

// ---------------------------------------------------------------------------
// triggerDeployment (Step 3b)
// ---------------------------------------------------------------------------

export interface TriggerDeploymentParams {
  cfAccountId: string;
  cfApiToken: string;
  projectName: string;
}

export interface TriggerDeploymentResult {
  deploymentId: string;
}

/**
 * POST /accounts/{cfAccountId}/pages/projects/{projectName}/deployments
 * Explicitly kicks off the first build after project creation.
 * CF does not auto-deploy from existing commits when a project is first
 * connected via API — only new commits trigger webhook builds. This call
 * bridges that gap so pollDeploymentReady has something to wait on.
 */
export async function triggerDeployment(
  params: TriggerDeploymentParams,
): Promise<TriggerDeploymentResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${params.cfAccountId}/pages/projects/${params.projectName}/deployments`;
  const resp = await cloudflareFetch({
    operation: `triggerDeployment ${params.projectName}`,
    url,
    init: {
      method: "POST",
      headers: authHeaders(params.cfApiToken),
      body: JSON.stringify({}),
    },
  });
  if (resp.status === 200 || resp.status === 201) {
    const json = (await resp.json()) as { result: { id: string } };
    return { deploymentId: json.result.id };
  }
  const bodyText = await resp.text();
  throw new CloudflareApiError(
    resp.status,
    bodyText,
    `triggerDeployment unexpected ${resp.status}: ${bodyText.slice(0, 200)}`,
  );
}

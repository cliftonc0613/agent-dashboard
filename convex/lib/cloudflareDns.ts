"use node";

/**
 * cloudflareDns.ts — DNS record creation for Luke's custom-domain step.
 *
 * Routes through cloudflareFetch (5xx retry policy) from ./cloudflare. Error
 * codes 81053 (record already exists with that name+content) and 81057
 * (duplicate content for the same name) are treated as idempotent success so
 * Luke can resume a partial run without manual cleanup.
 */

import { cloudflareFetch, CloudflareApiError } from "./cloudflare";

export interface CreateCnameParams {
  cfApiToken: string;
  cfZoneId: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
}

export interface CnameResult {
  created: boolean;
  alreadyExisted: boolean;
}

const IDEMPOTENT_ERROR_CODES = new Set([81053, 81057]);

export async function createCnameRecord(
  p: CreateCnameParams,
): Promise<CnameResult> {
  const url = `https://api.cloudflare.com/client/v4/zones/${p.cfZoneId}/dns_records`;
  const body = {
    type: "CNAME",
    name: p.name,
    content: p.content,
    ttl: p.ttl ?? 1,
    proxied: p.proxied ?? false,
  };

  const resp = await cloudflareFetch({
    operation: `createCnameRecord ${p.name} → ${p.content}`,
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${p.cfApiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
  });

  if (resp.status === 200 || resp.status === 201) {
    return { created: true, alreadyExisted: false };
  }

  if (resp.status === 400) {
    const bodyText = await resp.text();
    try {
      const parsed = JSON.parse(bodyText) as {
        errors?: Array<{ code?: number; message?: string }>;
      };
      const errors = parsed.errors ?? [];
      if (errors.some((e) => e.code !== undefined && IDEMPOTENT_ERROR_CODES.has(e.code))) {
        return { created: false, alreadyExisted: true };
      }
      const firstMsg = errors[0]?.message ?? bodyText.slice(0, 200);
      throw new CloudflareApiError(
        400,
        bodyText,
        `createCnameRecord 400 for ${p.name}: ${firstMsg}`,
      );
    } catch (e) {
      if (e instanceof CloudflareApiError) throw e;
      throw new CloudflareApiError(
        400,
        bodyText,
        `createCnameRecord 400 (unparseable body) for ${p.name}: ${bodyText.slice(0, 200)}`,
      );
    }
  }

  const bodyText = await resp.text();
  throw new CloudflareApiError(
    resp.status,
    bodyText,
    `createCnameRecord unexpected ${resp.status} for ${p.name}: ${bodyText.slice(0, 200)}`,
  );
}

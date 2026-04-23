"use node";

const UA = "Mozilla/5.0 (compatible; RebelAllianceBot/1.0; +https://rebelalliance.local)";

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export async function verifyLinkedInProfile(
  url: string,
  expectedOwnerName: string,
): Promise<VerifyResult> {
  try {
    const headRes = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": UA },
    });
    if (headRes.status === 999 || headRes.status === 429) {
      return { ok: false, reason: `linkedin_blocked_${headRes.status}` };
    }
    if (!headRes.ok) return { ok: false, reason: `head_${headRes.status}` };

    const getRes = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": UA },
    });
    if (!getRes.ok) return { ok: false, reason: `get_${getRes.status}` };

    const html = await getRes.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    const ogMatch = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    const candidates = [titleMatch?.[1] ?? "", ogMatch?.[1] ?? ""];

    const nameParts = expectedOwnerName.toLowerCase().split(/\s+/).filter(Boolean);
    if (nameParts.length === 0) return { ok: false, reason: "empty_owner_name" };

    const hasAll = candidates.some((c) =>
      nameParts.every((p) => c.toLowerCase().includes(p)),
    );
    if (!hasAll) return { ok: false, reason: "name_mismatch" };

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch_failed" };
  }
}

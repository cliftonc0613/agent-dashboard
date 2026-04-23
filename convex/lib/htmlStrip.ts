"use node";

export async function fetchAndStripHtml(url: string, maxBytes = 50_000): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AhsokaReviewer/1.0)" },
  });
  if (!res.ok) throw new Error(`fetchAndStripHtml HTTP ${res.status} for ${url}`);
  let html = await res.text();

  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script\b[^>]*\/>/gi, "");
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  html = html.replace(/\s+/g, " ");

  if (Buffer.byteLength(html, "utf8") <= maxBytes) return html;

  const buf = Buffer.from(html, "utf8");
  let cut = maxBytes;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
  return buf.subarray(0, cut).toString("utf8");
}

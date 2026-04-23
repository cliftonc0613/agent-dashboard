"use node";

const BROWSERLESS_BASE = "https://production-sfo.browserless.io";

function requireToken(): string {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not set");
  return token;
}

export async function takeMobileScreenshot(url: string): Promise<string> {
  const token = requireToken();
  const launchParams = encodeURIComponent(JSON.stringify({ ignoreHTTPSErrors: true }));
  const endpoint = `${BROWSERLESS_BASE}/screenshot?token=${token}&launch=${launchParams}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      options: { type: "png", fullPage: false },
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
      gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
      bestAttempt: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Browserless screenshot HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

export async function measurePageSpeed(url: string): Promise<number> {
  const token = requireToken();

  try {
    const start = Date.now();
    const endpoint = `${BROWSERLESS_BASE}/content?token=${token}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return 3000;
    return Date.now() - start;
  } catch {
    return 3000;
  }
}

export async function waitForCertReady(
  url: string,
  maxAttempts = 25,
): Promise<"ok" | "timeout"> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      if (res.ok || res.status === 404) return "ok";
    } catch {
      // cert not ready — retry
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return "timeout";
}

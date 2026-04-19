"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

/**
 * telegram.ts — Star Wars-voiced Telegram notifier for every agent in the system.
 *
 * This is the single notifier every future phase will call:
 *   - Phase 9.5 morning briefing summary (Yoda voice)
 *   - C-3PO error alerts (Phase 6+ pipeline orchestration)
 *   - R2-D2 smoke test signal (Phase 3 — see convex/agents/_test.ts)
 *
 * Non-negotiables (burned in after Phase 3 retro):
 *   1. sendTelegram NEVER throws. Returns { sent: boolean, reason?: string }.
 *      Rationale: a notifier that takes down the caller on a 500 from Telegram
 *      is worse than no notifier at all. Callers that care check the return
 *      shape; callers that don't (fire-and-forget success signals) ignore it.
 *   2. redactSecrets() runs on every string that might echo back into console
 *      output. Telegram error bodies can leak request URLs that include bot
 *      tokens — the redactor strips those + all other known secrets before
 *      anything hits stdout.
 *   3. Node runtime — required for fetch with AbortSignal.timeout() and for
 *      process.env access over secrets set via `npx convex env set`.
 *   4. HTML parse_mode (not MarkdownV2). Telegram's MarkdownV2 requires
 *      escaping 18+ special chars; HTML needs exactly 3 (&, <, >). Less
 *      surface area to get wrong.
 */

/**
 * redactSecrets — strips every known secret env var value from a string,
 * replacing each occurrence with `[REDACTED]`.
 *
 * Uses split/join rather than regex because tokens commonly contain characters
 * that are regex-meaningful (`.`, `/`, `+`, `=`) and escaping them per-secret
 * would be error-prone. Exact-match replacement is both safer and faster for
 * this use case.
 *
 * Exported so callers (and tests) can redact arbitrary strings before logging.
 */
export function redactSecrets(text: string): string {
  const secrets = [
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.ANTHROPIC_API_KEY,
    process.env.GITHUB_TOKEN,
    process.env.VERCEL_TOKEN,
    process.env.BROWSERLESS_TOKEN,
    process.env.FIRECRAWL_API_KEY,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  let out = text;
  for (const s of secrets) {
    out = out.split(s).join("[REDACTED]");
  }
  return out;
}

/**
 * escapeHtml — escape the three characters Telegram's HTML parse_mode
 * reserves. Private helper; callers should always route text through this
 * before embedding in the <b>...</b> wrapper.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const LEVEL_EMOJI = {
  info: "🟡",
  success: "🟢",
  warning: "🟠",
  error: "🔴",
} as const;

export const sendTelegram = internalAction({
  args: {
    character: v.string(),
    level: v.union(
      v.literal("info"),
      v.literal("success"),
      v.literal("warning"),
      v.literal("error"),
    ),
    title: v.string(),
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.warn(
        "[telegram] skipping send — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set",
      );
      return { sent: false, reason: "env_unset" };
    }

    const emoji = LEVEL_EMOJI[args.level];
    const message = [
      `[${escapeHtml(args.character)}] ${emoji} <b>${escapeHtml(args.title)}</b>`,
      "",
      escapeHtml(args.body),
    ].join("\n");

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!res.ok) {
        const errBody = redactSecrets(await res.text());
        console.error(`[telegram] send failed: ${res.status} ${errBody}`);
        return { sent: false, reason: `http_${res.status}` };
      }

      return { sent: true };
    } catch (err) {
      const msg = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      console.error(`[telegram] send error: ${msg}`);
      return { sent: false, reason: "exception" };
    }
  },
});

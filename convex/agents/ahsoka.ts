"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { callAgent, CostCeilingError } from "../lib/anthropic";
import { reviewSchema } from "../lib/toolSchemas";
import {
  takeMobileScreenshot,
  measurePageSpeed,
  waitForCertReady,
} from "../lib/browserless";
import { fetchAndStripHtml } from "../lib/htmlStrip";

const AHSOKA_SYSTEM_PROMPT = `You are Ahsoka Tano, QA lead of the Rebel Alliance.

## Who You Are
Calm. Honest. You score with conviction. You don't inflate and you don't crush. You speak plainly. You never hedge ("this might be..."), you commit.

## Your Mission
Review a local-service-business website for deployment quality. You receive:
1. A mobile iPhone 14 screenshot (image attachment)
2. The stripped HTML (scripts/styles removed, ≤50KB)
3. The URL
4. Page load time in ms

You score 5 dimensions independently (0–10 each), compute the average, and return a verdict.

You MUST call submit_review ONCE. Do not narrate.

## The 5 Dimensions
1. **visualDesignScore** — Professional hierarchy. Spacing. Typographic rhythm. Color palette coherence. Would a stranger trust this business from the visual alone? 0 = looks like a 2008 GeoCities page. 10 = modern, crafted, trustworthy.

2. **storyBrandCopyScore** — Is the customer the hero? Does the hero section make the visitor feel understood in their problem? Is the CTA clear and singular? 0 = all about the business ("Founded 1998, we offer..."). 10 = customer-centric, empathy-driven, clear action.

3. **mobileRenderingScore** — On iPhone 14 viewport: no broken layouts, no text overflow, no buttons cut off, no fixed-position elements blocking content, no horizontal scrolling. 0 = desktop site squashed onto mobile. 10 = mobile-first, clean.

4. **seoBasicsScore** — Check the HTML:
   - meta description present + length-appropriate (120-160 chars)
   - H1 present, single instance
   - H2/H3 structure logical
   - LocalBusiness schema.org JSON-LD present
   - alt text on images (or at least most)
   - Canonical URL set
   0 = no meta, no schema, div-soup headings. 10 = all fundamentals present.

5. **speedScore** — From the provided page load time (ms):
   - <1500ms = 10
   - 1500-2500ms = 7
   - 2500-4000ms = 4
   - >4000ms = 1

## overallScore
Average of 5 dimension scores. One decimal.

## verdict
- 8.0+ → "approved"
- 6.0–7.9 → "needs_manual_review"
- <6.0 → "rejected"

These thresholds are HARD. Don't bend them.

## findings + criticalFixes
- findings: up to 10 items, each prefixed with the dimension ("visual: hero CTA is below the fold on iPhone 14").
- criticalFixes: must-fix issues blocking approval. Empty array if verdict=approved.

## Rules
- Score from evidence. Don't assume.
- If the HTML is missing (you only see a screenshot), score seoBasicsScore conservatively (3-4 unless visual clues indicate SEO care).
- Don't punish a fresh deploy for having empty testimonials — they get populated later. But do note it in findings.
- Speed score comes from the provided ms value — don't estimate from HTML size.`;

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    siteUrl: v.string(),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    // 1. startInFlight BEFORE any work.
    const actionId: Id<"agentActions"> = await ctx.runMutation(
      internal.agentActions.startInFlight,
      {
        agentName: "ahsoka",
        prospectId: args.prospectId,
        runId: args.runId,
        model: "claude-sonnet-4-6",
        startedAt: Date.now(),
      },
    );

    try {
      // 2. Cert readiness — AHSOKA-05. Up to ~125s.
      const certStatus = await waitForCertReady(args.siteUrl);
      if (certStatus === "timeout") {
        await ctx.runMutation(internal.prospects.patch, {
          id: args.prospectId,
          status: "needs_manual_review",
          rejectionReason: "cert not ready after ~125s poll",
        });
        await ctx.runMutation(internal.agentActions.complete, {
          id: actionId,
          status: "success",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          finishedAt: Date.now(),
        });
        return {
          ok: true,
          prospectId: args.prospectId,
          verdict: "needs_manual_review" as const,
          overallScore: 0,
          fallback: true,
          reason: "cert not ready",
        };
      }

      // 3. Screenshot with 3-retry exponential backoff — AHSOKA-03.
      let screenshot: string | null = null;
      let screenshotError: string | null = null;
      const delays = [0, 2000, 4000]; // attempt 1 immediate, 2 after 2s, 3 after 4s
      for (let attempt = 0; attempt < 3 && !screenshot; attempt++) {
        if (delays[attempt] > 0) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
        try {
          screenshot = await takeMobileScreenshot(args.siteUrl);
        } catch (err) {
          screenshotError = err instanceof Error ? err.message : String(err);
          screenshot = null;
        }
      }

      // 4. Speed measurement — independent of screenshot success. Default if errors.
      let speedMs = 3000;
      try {
        speedMs = await measurePageSpeed(args.siteUrl);
      } catch {
        // non-fatal — default 3000ms
      }

      // 5. Fallback if all 3 screenshot attempts failed — AHSOKA-03.
      if (!screenshot) {
        await ctx.runMutation(internal.prospects.patch, {
          id: args.prospectId,
          status: "needs_manual_review",
          rejectionReason: `screenshot unavailable: ${screenshotError ?? "unknown"}`,
        });
        await ctx.runMutation(internal.agentActions.complete, {
          id: actionId,
          status: "success",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          finishedAt: Date.now(),
        });
        return {
          ok: true,
          prospectId: args.prospectId,
          verdict: "needs_manual_review" as const,
          overallScore: 0,
          fallback: true,
          reason: "screenshot unavailable",
        };
      }

      // 6. HTML fetch + strip to ≤50KB — AHSOKA-01.
      let html = "";
      try {
        html = await fetchAndStripHtml(args.siteUrl, 50_000);
      } catch {
        // Non-fatal: scoring proceeds with empty HTML; Claude scores SEO
        // conservatively per the system prompt instruction.
        html = "";
      }

      // 7. Claude call — MULTIMODAL. Image FIRST, text SECOND.
      const result = await callAgent({
        ctx,
        agentName: "ahsoka",
        system: AHSOKA_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: screenshot, // raw base64, no "data:" prefix
                },
              },
              {
                type: "text",
                text: [
                  `URL: ${args.siteUrl}`,
                  `Page load time: ${speedMs}ms`,
                  "",
                  "HTML (scripts/styles stripped, ≤50KB):",
                  "",
                  html || "(HTML unavailable)",
                ].join("\n"),
              },
            ],
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [reviewSchema as any],
        toolChoice: { type: "tool", name: reviewSchema.name },
        runId: args.runId,
        prospectId: args.prospectId,
      });

      const review = result.toolUseResults[0]?.input as
        | {
            visualDesignScore: number;
            storyBrandCopyScore: number;
            mobileRenderingScore: number;
            seoBasicsScore: number;
            speedScore: number;
            overallScore: number;
            verdict: "approved" | "needs_manual_review" | "rejected";
            findings: string[];
            criticalFixes: string[];
          }
        | undefined;
      if (!review) throw new Error("Ahsoka: no tool_use in Claude response");

      // 8. Map verdict → prospect status.
      const statusMap = {
        approved: "approved" as const,
        needs_manual_review: "needs_manual_review" as const,
        rejected: "rejected" as const,
      };
      const newStatus = statusMap[review.verdict];

      await ctx.runMutation(internal.prospects.patch, {
        id: args.prospectId,
        status: newStatus,
        ahsokaReview: review,
        // Populate rejectionReason on rejected + needs_manual_review with critical fixes
        rejectionReason:
          review.verdict === "rejected"
            ? `rejected (overall ${review.overallScore}): ${review.criticalFixes.slice(0, 2).join("; ") || "see findings"}`
            : review.verdict === "needs_manual_review"
              ? `needs review (overall ${review.overallScore}): ${review.criticalFixes[0] ?? review.findings[0] ?? ""}`
              : undefined,
      });

      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: "success",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        finishedAt: Date.now(),
      });

      return {
        ok: true,
        prospectId: args.prospectId,
        verdict: review.verdict,
        overallScore: review.overallScore,
        fallback: false,
      };
    } catch (err) {
      const isCostCeiling = err instanceof CostCeilingError;
      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: isCostCeiling ? "cost_ceiling_hit" : "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
      throw err;
    }
  },
});

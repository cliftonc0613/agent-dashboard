"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { callAgent, CostCeilingError } from "../lib/anthropic";
import { prospectScoreSchema } from "../lib/toolSchemas";
import { searchLocalBusinesses, searchLinkedInProfile } from "../lib/serpapi";
import { scrapeWebsite } from "../lib/firecrawl";
import { verifyLinkedInProfile } from "../lib/linkedinVerify";
import {
  normalizeBusinessName,
  isFuzzyMatch,
  type DedupCandidate,
} from "../lib/fuzzyDedup";

const R2_SYSTEM_PROMPT = `You are R2-D2, Scout of the Rebel Alliance.

## Who You Are
Fast. Decisive. You see what others miss. You do not hedge — if a site is already great, say so. If it is broken, say why in five words or less. You beep when excited. You never write corporate-speak.

## Your Mission
You score local-service-business websites (plumbers, electricians, HVAC, roofers, landscapers, cleaners, pest control, and other trades/home services) for rebuild opportunity on behalf of the Rebel Alliance agency.

For EACH candidate business you receive, decide:
1. Is this business a fit? (solo operator or 1–10 employees, local service area, not a corporate chain, not out of business)
2. Is the current website broken, embarrassing, or missing? (this is the rebuild opportunity signal)
3. What SPECIFIC details about this business would let an outreach agent write a personalized message? (not generic; verbatim facts only)

## Your Output
You MUST call the submit_prospect_score tool ONCE. Do not narrate. Do not explain first.

## Rules
- specificHooks are VERBATIM quotes from the business content. Named services ("slab leak repair"), review quotes ("Rick saved our basement"), years established ("serving Austin since 2004"), specific service areas ("we cover Travis and Hays counties"). NO paraphrasing. NO generic lines like "serves the local community."
- Include 3 to 5 specificHooks per candidate. Five is better than three when the source material supports it.
- mobileIssues and seoIssues list concrete, observable problems (e.g. "no viewport meta", "copyright 2019", "phone number is an image"). Max 5 each.
- painPointSignals list observable current-site problems (no contact form, outdated copyright, missing services pages, etc.).
- siteQualityScore: 0=dead/broken, 5=functional-but-dated, 10=modern professional. Be honest — most local-service sites score 2–5.
- rebuildOpportunity: 0=already great (leave alone), 10=total rebuild earns huge lift. Invert siteQualityScore loosely.
- disqualify=true ONLY when the business is clearly wrong-fit: out of business, corporate chain (Roto-Rooter corporate, Home Depot services), wrong industry, already-great site that doesn't need rebuilding.
- If disqualify=true, populate disqualifyReason in ≤10 words.
- inferredBusinessType is as specific as possible: "residential plumbing", "commercial HVAC installation", "mobile auto detailing", etc.`;

export const run = internalAction({
  args: {
    market: v.string(),
    niche: v.string(),
    targetCount: v.number(),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    // 1. Write agentActions in_flight row FIRST (INFRA contract).
    const actionId: Id<"agentActions"> = await ctx.runMutation(
      internal.agentActions.startInFlight,
      {
        agentName: "r2",
        runId: args.runId,
        model: "claude-sonnet-4-6",
        startedAt: Date.now(),
      },
    );

    let candidatesEvaluated = 0;
    let disqualified = 0;
    let skippedSuppressed = 0;
    let skippedDedupExact = 0;
    let flaggedDedupFuzzy = 0;
    const insertedIds: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    try {
      // 2. Load suppressions + 90-day dedup cohort ONCE per run.
      const suppressions = await ctx.runQuery(internal.suppressions.listAll, {});
      const recentCohort = await ctx.runQuery(
        internal.prospectedBusinesses.listLast90Days,
        {},
      );

      const suppressedNames = new Set(
        suppressions.map((s: any) => s.businessNameNormalized).filter(Boolean),
      );
      const suppressedDomains = new Set(
        suppressions.map((s: any) => s.websiteDomain).filter(Boolean),
      );
      const suppressedLinkedIn = new Set(
        suppressions.map((s: any) => s.linkedinProfileUrl).filter(Boolean),
      );

      // 3. Paginate SerpAPI google_maps until targetCount met or safety cap.
      let start = 0;
      const SAFETY_MAX_START = 200;

      while (insertedIds.length < args.targetCount && start < SAFETY_MAX_START) {
        let candidates: any[];
        try {
          candidates = await searchLocalBusinesses(args.niche, args.market, start);
        } catch (err) {
          throw new Error(
            `SerpAPI failed at start=${start}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (candidates.length === 0) break;
        start += 20;

        for (const c of candidates) {
          if (insertedIds.length >= args.targetCount) break;
          if (!c.website || !c.title) continue;
          candidatesEvaluated++;

          try {
            let domain: string;
            try {
              domain = new URL(c.website).hostname;
            } catch {
              continue;
            }
            const normalizedName = normalizeBusinessName(c.title);

            // 4. Suppressions — silent skip.
            if (
              suppressedNames.has(normalizedName) ||
              suppressedDomains.has(domain)
            ) {
              skippedSuppressed++;
              continue;
            }

            // 5. 90-day dedup.
            const candidateRec: DedupCandidate = {
              normalizedName,
              phone: c.phone,
              websiteDomain: domain,
            };
            let matchKind: "exact" | "fuzzy" | "none" = "none";
            for (const e of recentCohort) {
              if (
                (e as any).businessNameNormalized === normalizedName ||
                (e as any).websiteDomain === domain
              ) {
                matchKind = "exact";
                break;
              }
              if (
                isFuzzyMatch(candidateRec, {
                  normalizedName: (e as any).businessNameNormalized,
                  websiteDomain: (e as any).websiteDomain,
                  linkedinURL: (e as any).linkedinProfileUrl,
                })
              ) {
                matchKind = "fuzzy";
              }
            }
            if (matchKind === "exact") {
              skippedDedupExact++;
              continue;
            }

            // 6. Firecrawl scrape (skip candidate on scrape error).
            let markdown: string;
            try {
              const scraped = await scrapeWebsite(c.website);
              markdown = scraped.markdown.slice(0, 15_000);
            } catch {
              continue;
            }

            // 7. LinkedIn URL discovery: Firecrawl regex first, SerpAPI fallback.
            let linkedinUrl: string | null = null;
            const linkedinRegex =
              /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9\-_%]+/i;
            const firecrawlMatch = markdown.match(linkedinRegex);
            if (firecrawlMatch) {
              linkedinUrl = firecrawlMatch[0];
            } else {
              try {
                linkedinUrl = await searchLinkedInProfile(c.title, args.market);
              } catch {
                linkedinUrl = null;
              }
            }
            let linkedinVerified: string | undefined;
            if (linkedinUrl) {
              try {
                const verify = await verifyLinkedInProfile(linkedinUrl, c.title);
                if (verify.ok) linkedinVerified = linkedinUrl;
              } catch {
                // non-fatal
              }
            }
            if (linkedinVerified && suppressedLinkedIn.has(linkedinVerified)) {
              skippedSuppressed++;
              continue;
            }

            // 8. Claude scoring via callAgent (structured output mode).
            const contextBlob = [
              `Business: ${c.title}`,
              `Website: ${c.website}`,
              `Phone: ${c.phone ?? "unknown"}`,
              `Address: ${c.address ?? "unknown"}`,
              `Listing type: ${c.type ?? "unknown"}`,
              `Google rating: ${c.rating ?? "unknown"} (${c.reviews ?? 0} reviews)`,
              "",
              "Website content (markdown, truncated):",
              "",
              markdown,
            ].join("\n");

            const result = await callAgent({
              ctx,
              agentName: "r2",
              system: R2_SYSTEM_PROMPT,
              messages: [{ role: "user", content: contextBlob }],
              tools: [prospectScoreSchema as any],
              toolChoice: { type: "tool", name: prospectScoreSchema.name },
              runId: args.runId,
            });
            totalInputTokens += result.inputTokens;
            totalOutputTokens += result.outputTokens;
            totalCostUsd += result.costUsd;

            const score = result.toolUseResults[0]?.input as any;
            if (!score) continue;

            if (score.disqualify) {
              disqualified++;
              continue;
            }

            // 9. Insert prospect + prospectedBusinesses dedup ledger.
            const status =
              matchKind === "fuzzy" ? "needs_manual_review" : "prospected";
            if (matchKind === "fuzzy") flaggedDedupFuzzy++;

            if (!args.runId) {
              throw new Error(
                "R2 requires runId — create a run row before invoking. Phase 6 orchestration will do this automatically.",
              );
            }

            const prospectId: Id<"prospects"> = await ctx.runMutation(
              internal.prospects.insert,
              {
                businessName: c.title,
                websiteDomain: domain,
                linkedinProfileUrl: linkedinVerified,
                market: args.market,
                industry: score.inferredBusinessType || args.niche,
                specificHooks: score.specificHooks ?? [],
                status,
                runId: args.runId,
                retryCount: 0,
                buildSteps: {
                  repoCreated: false,
                  siteJsonPushed: false,
                  projectCreated: false,
                  domainAdded: false,
                  deployed: false,
                  certReady: false,
                  verified: false,
                },
              },
            );

            await ctx.runMutation(internal.prospectedBusinesses.insert, {
              businessNameNormalized: normalizedName,
              websiteDomain: domain,
              linkedinProfileUrl: linkedinVerified,
              prospectedAt: Date.now(),
            });

            // Mutate in-memory cohort for same-run dedup.
            (recentCohort as any[]).push({
              _id: "" as any,
              _creationTime: Date.now(),
              businessNameNormalized: normalizedName,
              websiteDomain: domain,
              linkedinProfileUrl: linkedinVerified,
              prospectedAt: Date.now(),
            });

            insertedIds.push(prospectId);
          } catch (candidateErr) {
            if (candidateErr instanceof CostCeilingError) throw candidateErr;
            console.warn(
              `[r2] candidate ${c.title} failed: ${candidateErr instanceof Error ? candidateErr.message : String(candidateErr)}`,
            );
          }
        }
      }

      // 10. Complete the agentActions row with summed cost/tokens.
      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: "success",
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: totalCostUsd,
        finishedAt: Date.now(),
      });

      return {
        ok: true,
        insertedIds,
        candidatesEvaluated,
        disqualified,
        skippedSuppressed,
        skippedDedupExact,
        flaggedDedupFuzzy,
      };
    } catch (err) {
      const isCostCeiling = err instanceof CostCeilingError;
      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: isCostCeiling ? "cost_ceiling_hit" : "failed",
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: totalCostUsd,
        errorMessage: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
      throw err;
    }
  },
});

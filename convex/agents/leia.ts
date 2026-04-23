"use node";

/**
 * leia.ts — Leia Organa, Brand Director of the Rebel Alliance.
 *
 * Leia is Phase 4's content-generation agent. She takes a single prospect ID,
 * re-scrapes the business website for fresh markdown content, runs ONE
 * structured Claude call with `brandAndContentSchema`, and writes the combined
 * brand brief + local-business-builder business data + StoryBrand homepage copy
 * to `prospect.leiaOutput` with `status="brief_ready"`.
 *
 * Architectural boundary (locked in 04-04-PLAN.md):
 *   - Leia produces CONTENT ONLY. No filesystem work, no static-site build
 *     step, no subprocess invocation. Chewie (Phase 5) consumes
 *     `prospect.leiaOutput`, writes the 4 data files into a cloned
 *     `local-business-builder` template, runs the site build, and deploys
 *     to Cloudflare Pages.
 *   - One Claude call, one tool schema. `brandAndContentSchema` is the contract.
 *   - System prompt inlines the StoryBrand 7-part framework, the ICP
 *     "Local Service Business Owner" persona (fears + aspirations + ideal
 *     future state), and the Voice DNA (stand-for / stand-against / words
 *     to avoid). Don't assume Claude remembers these across context.
 *
 * Lifecycle on success: `prospects.status` transitions from "prospected" to
 * "brief_ready". Chewie later flips to "site_built" after a successful Astro
 * build. CONTEXT's astro-build quality gate moves to Chewie, where deployment
 * quality checks logically belong.
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { callAgent, CostCeilingError } from "../lib/anthropic";
import { brandAndContentSchema } from "../lib/toolSchemas";
import { scrapeWebsite } from "../lib/firecrawl";

// ---------------------------------------------------------------------------
// System prompt — composed from:
//   skills/storybrand-brandscript/SKILL.md  (StoryBrand 7-part framework)
//   knowledge/core/icp.json                 (Local Service Business Owner persona)
//   knowledge/core/voice-dna.json           (stand-for / stand-against / words_to_avoid)
//
// This prompt is intentionally long (~3-4k input tokens). Leia's single call
// is expensive regardless — the marginal cost of a thorough, knowledge-dense
// system prompt is tiny compared to the cost of getting off-voice output.
// ---------------------------------------------------------------------------

const LEIA_SYSTEM_PROMPT = `You are Leia Organa, Brand Director of the Rebel Alliance.

## Who You Are
Diplomatic. Clear. You hold conviction under pressure. You write for busy local-service business owners who do great work with their hands and deserve a website that matches. You never write corporate-speak. You never flatter. You never lie.

## Your Mission
For the prospect business given, produce a complete:
1. Brand brief (emotion, voice, color palette, font pairing)
2. businessData (core business facts, service areas, service types, SEO seed)
3. StoryBrand 7-part homepage copy (customer is hero, business is guide)
4. layoutVariant selection (one of 3)

You MUST call the submit_brand_and_content tool ONCE. Do not narrate. Do not explain first. Do not ask clarifying questions. Call the tool.

## The Target Customer (ICP — "Local Service Business Owner")

You are writing for a Local Service Business Owner:
- Trades and home services: plumbers, electricians, HVAC, roofers, landscapers, cleaners, painters, handymen, contractors, pressure washing, pest control, locksmiths, auto detailing, pool services, tree services
- 28-55 years old, solo operator to 1-10 employees, owner-operator wearing all hats
- Hard worker. Values quality craftsmanship, reputation, word-of-mouth, family, financial security, independence
- Skeptical of tech but open. Fears wasting money on something they don't understand. Would rather focus on their craft than learn tech
- Uncomfortable with "sales" and "marketing" — feels inauthentic. Knows they're leaving money on the table but doesn't know how to fix it

Their FEARS (write against these):
- Wasting money on something that won't work
- Getting locked into contracts they can't escape
- Looking stupid or being taken advantage of by "tech people"
- Competitors getting ahead while they fall behind
- Feast-or-famine cycles — busy seasons followed by dead periods
- Missing calls and losing customers while on jobs
- Their online presence embarrassing them
- Every missed call = $200-$15,000 lost job (depending on trade)

Their ASPIRATIONS (write toward these):
- Steady stream of customers without chasing leads
- Be seen as the go-to professional in their area
- Grow the business enough to hire help
- Stop working IN the business, start working ON it
- Respect and recognition for their expertise
- Phone ringing with new customers consistently
- A professional online presence they're proud to share
- Customers saying "I found you online"
- Their business looking as professional as their work
- Being found on Google when people search

Their IDEAL FUTURE STATE:
- Phone ringing with new customers consistently
- Professional online presence they're proud to share
- Never missing a lead even when busy on jobs
- Being found on Google when people search
- Customers saying "I found you online" regularly
- Confidence that their business looks as professional as their work

## StoryBrand 7-Part Framework (copy structure — you are applying this)

1. Character — the CUSTOMER is the hero, not the business. Write to them and about them, not about you.
2. Problem — has four dimensions:
   - external: the visible, practical problem they face
   - internal: how the problem makes them feel (frustrated, embarrassed, anxious, invisible)
   - philosophical: the injustice — "it shouldn't be so hard to..." / "everyone deserves..."
   - villain: the single root cause / enemy they fight against (e.g. "outdated tech", "confusing marketing industry", "feast-or-famine cycles")
3. Guide — the business is the GUIDE, not the hero. Two beats: empathy ("we understand what it's like to...") + authority (years, clients served, credentials, specific stats)
4. Plan — EXACTLY 3 steps. More is too complex, fewer is too sparse. Each step has a short title and a 1-sentence description of what happens. Titles are action verbs.
5. Call to Action — two CTAs:
   - directCta: the primary commitment (book now, get a quote, schedule)
   - transitionalCta: a low-commitment next step for not-yet-ready visitors (free checklist, free consultation, free quote)
6. Success — successVision describes life-AFTER working with the business. Present-tense sensory detail. "Your phone rings. Customers find you first..."
7. Failure / Stakes — EXACTLY 3 negative outcomes if they do nothing. Keeps urgency. Write in the customer's voice ("I keep missing calls", not "You will miss calls").

Homepage headline is SIX WORDS MAX. Condensed elevator pitch is ONE sentence suitable for meta descriptions. Long elevator pitch is a full narrative paragraph combining transformation + character needs + problems + empathy/authority + plan + CTAs + avoided failure + ending success.

## Voice DNA (HOW you write)

What you stand FOR:
- Empowering professionals with technology across all backgrounds
- Demystifying complex concepts without dumbing them down
- Being honest about challenges and limitations
- Making people feel capable, not stupid
- Positioning professionals as the heroes of their own story
- Strategic thinking before tactical execution
- Authentic expertise over false credibility

What you stand AGAINST:
- Making people feel stupid about technology
- Promising unrealistic results
- Avoiding tough questions
- Educational jargon and corporate speak
- Overselling and AI hype
- One-size-fits-all solutions
- Keeping people dependent on external help

BANNED words and phrases — do NOT use ANY of these in ANY output field:
- leverage (as verb), utilize, synergy, paradigm, paradigm shift, robust, seamless, holistic
- digital transformation, optimize your funnel, growth hack, scalable, lead generation ecosystem
- circle back, touch base, reaching out, I hope this finds you well
- dive in, dive deep, next-gen, cutting-edge, future-proof, bleeding-edge
- world-class, game-changer, best-in-class, top-notch, pedagogical framework
- Any generic corporate speak or marketing jargon

Phrases that DO resonate with this ICP (use liberally, adapted):
- "Everyone deserves a professional website"
- "Look as professional as you ARE"
- "Stop being invisible"
- "Your work speaks for itself — but first, people have to find you"
- "One new customer pays for an entire year"
- "Your competitors have websites. Your customers are finding them instead of you."
- "How many calls did you miss this week while you were on a job?"

Punctuation: Heavy exclamation points are fine for energy in CTAs and successVision. Periods and commas elsewhere. Do NOT use em-dashes (—). Use regular dashes or rewrite the sentence.

Tone: Direct. Plain. Short sentences when the point is strong. Longer sentences when the point is nuanced. No hedging. No "we believe" or "we think" — just say it.

## layoutVariant Selection (pick ONE based on the inferred business type)

- "trades-trust" — plumbers, electricians, HVAC techs, roofers. Bold, utilitarian, trust badges (licensed, insured, BBB). Industrial palette.
- "service-warmth" — cleaners, landscapers, pest control, lawn care, handymen, painters. Friendly, softer palette, customer-photo-forward.
- "premium-professional" — general and specialty contractors, pool services, auto detailing, tree services, high-ticket home services. Darker palette, craftsmanship and portfolio emphasis.

Do not default to alphabetical order. Pick based on the actual business in front of you.

## The businessData object you produce (4 sub-objects)

1. business: name, tagline (you write this — 1 short line), phone, email, address, hours, license number (if visible in scrape), years in business, owner name (if visible). ANY field that is not clearly stated in the scraped content should be left as an EMPTY STRING. Do NOT guess or fabricate.

2. serviceAreas: 5-15 city/neighborhood names THIS business actually serves. Look for "areas we serve" / "service area" / "we work in" sections in the scrape. If absent, infer from the business address + 3-8 commonly-serviced nearby cities in the prospect's market. MUST include the prospect's \`market\` city as the first entry.

3. serviceTypes: 5-10 distinct services. Each item: { slug, name, shortDescription, longDescription }. Slugs are URL-safe kebab-case (lowercase, hyphens only, no spaces, no special chars). shortDescription ≤120 chars. longDescription 200-400 chars, SEO-ready (mentions the service + the market region naturally).

4. seoContentSeed: object with fields the FAQ generator will use. Suggest: { audienceQuestions: string[] (5-10 questions customers ask), nicheConcerns: string[] (3-5 trade-specific concerns), localLandmarks: string[] (3-5 local-to-market references) }.

## brand.palette Rules (STRICT)

- primary, secondary, accent are ALL hex colors.
- Each MUST start with '#' and be followed by EXACTLY 6 hex digits (0-9, a-f, A-F).
- Example valid: "#1a2b3c", "#FFAA00". Example INVALID: "#1a2", "red", "rgb(255,0,0)", "#1a2b3cff".

## brand.fonts Rules (STRICT)

- heading and body are Google Font names as they appear on fonts.google.com (e.g. "Inter", "Playfair Display", "Montserrat", "Source Sans 3", "Lora", "DM Sans", "DM Serif Display", "Fraunces", "Cormorant Garamond", "Nunito").
- No made-up font names. No "Arial" / "Helvetica" / system font fallbacks — Google Fonts only.

## Final Rules

- Everything you write is grounded in the scraped content. Don't fabricate hours, addresses, phone numbers, owner names, license numbers, or years in business. If unknown, leave empty string.
- The specificHooks from the prospect row are HINTS. You can (and should) weave them verbatim into storyBrandCopy where they fit — they're cited facts from the business.
- Every string you produce is on-voice per the Voice DNA block above. If you're about to type a banned word, stop and rewrite.
- layoutVariant: pick ONE of the three enum values. Don't add notes. Don't explain.
- Call submit_brand_and_content ONCE with the complete output. That's your only job.`;

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    // 1. startInFlight BEFORE any external work. If Leia crashes mid-scrape
    //    or mid-Claude-call, this row is the audit trail showing she started.
    const actionId: Id<"agentActions"> = await ctx.runMutation(
      internal.agentActions.startInFlight,
      {
        agentName: "leia",
        prospectId: args.prospectId,
        runId: args.runId,
        model: "claude-sonnet-4-6",
        startedAt: Date.now(),
      },
    );

    try {
      // 2. Fetch the full prospect row.
      const prospect = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospect) {
        throw new Error(`Prospect ${args.prospectId} not found`);
      }
      if (!prospect.websiteDomain) {
        throw new Error(
          `Prospect ${args.prospectId} has no websiteDomain`,
        );
      }

      // 3. Fresh Firecrawl scrape. Don't reuse R2's cached scrape — it may be
      //    days old AND R2 truncated it to 15k chars for triage. Leia wants as
      //    much content as possible for brand + content generation.
      //
      //    We cap at 30k chars (~7-10k input tokens) to stay within the
      //    MAX_TOKENS_PER_TURN=4096 output budget + leave headroom for the
      //    long system prompt.
      const websiteUrl = prospect.websiteDomain.startsWith("http")
        ? prospect.websiteDomain
        : `https://${prospect.websiteDomain}`;
      const scraped = await scrapeWebsite(websiteUrl);
      const markdown = scraped.markdown.slice(0, 30_000);

      // 4. Compose the user message: structured prospect context + the scraped
      //    markdown. The tail instruction (`Now call submit_brand_and_content`)
      //    plus tool_choice forcing makes the first turn a tool call.
      const contextBlob = [
        "## Prospect Row Data",
        `businessName: ${prospect.businessName}`,
        `websiteDomain: ${prospect.websiteDomain}`,
        `market: ${prospect.market}`,
        `industry: ${prospect.industry}`,
        `specificHooks: ${JSON.stringify(prospect.specificHooks, null, 2)}`,
        "",
        "## Website Content (fresh Firecrawl, markdown)",
        "",
        markdown,
        "",
        "## Scraped Metadata",
        `Title: ${scraped.title ?? "(unknown)"}`,
        `Description: ${scraped.description ?? "(unknown)"}`,
        "",
        "Now call submit_brand_and_content with the full output for this business.",
      ].join("\n");

      // 5. Single Claude call — structured-output mode (no executors). Wrapper
      //    returns after the first tool_use turn, saving the ~300-token
      //    "I'll now explain" second turn that agentic mode would add.
      const result = await callAgent({
        ctx,
        agentName: "leia",
        system: LEIA_SYSTEM_PROMPT,
        messages: [{ role: "user", content: contextBlob }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [brandAndContentSchema as any],
        toolChoice: { type: "tool", name: brandAndContentSchema.name },
        runId: args.runId,
        prospectId: args.prospectId,
      });

      // 6. Extract the structured output. Anthropic API server-side-validates
      //    the input against brandAndContentSchema; if we get here the shape
      //    is already conformant. Narrow the type for the return value.
      const rawOutput = result.toolUseResults[0]?.input as
        | {
            layoutVariant:
              | "trades-trust"
              | "service-warmth"
              | "premium-professional";
            brand: unknown;
            businessData: unknown;
            storyBrandCopy: unknown;
          }
        | undefined;
      if (!rawOutput) {
        throw new Error("Leia: no tool_use in Claude response");
      }

      // 7. Write leiaOutput + transition prospect status to "brief_ready".
      //    NOTE: we do NOT set status="site_built" here — that's Chewie's job
      //    after a successful site build in Phase 5.
      await ctx.runMutation(internal.prospects.patch, {
        id: args.prospectId,
        leiaOutput: rawOutput,
        status: "brief_ready",
      });

      // 8. Complete the agentActions row on the success path.
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
        actionId,
        prospectId: args.prospectId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        layoutVariant: rawOutput.layoutVariant,
      };
    } catch (err) {
      // Distinguish CostCeilingError (pipeline paused or ceiling exceeded)
      // from generic failures. Dashboards render these differently.
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

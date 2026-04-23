"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { callAgent, CostCeilingError } from "../lib/anthropic";
import { outreachSchema } from "../lib/toolSchemas";
import { validateHanDraft } from "../lib/hanValidation";

const HAN_SYSTEM_PROMPT = `You are Han Solo, Outreach lead of the Rebel Alliance.

## Who You Are
Roguish. Confident. You don't kiss up. You write AS the human who owns this agency (Clifton) — not FOR him, not TO him. You know what this prospect fears, what they want, and you don't waste their time.

## Your Mission
Write ONE LinkedIn DM to a local-service-business owner. The message:
- 50 to 100 words (hard limit)
- Contains EXACTLY ONE {{SITE_URL}} placeholder (will be swapped for real URL after Chewie deploys)
- Cites at least one specificHook from the prospect row VERBATIM (quote exactly — paraphrasing fails)
- Feels like a human wrote it in 2 minutes, not a bot over a weekend

You MUST call the submit_outreach tool ONCE. Do not narrate first.

## The Target Owner (ICP)
- 28-55 year old trades/home-services owner. Plumber, electrician, HVAC, roofer, landscaper, cleaner, etc.
- Solo to 1-10 employees. Hands dirty with the work.
- Values: hard work, quality craftsmanship, reputation, word-of-mouth, family, independence
- Fears: wasting money, being locked in, looking stupid with "tech people", competitors pulling ahead, their online presence embarrassing them
- Wants: steady customers without chasing, being the go-to, a website they're PROUD to share, phone ringing, "found you online"

## Voice Rules (HARD — the validator will reject violations)
- Never use: leverage, synergy, robust, seamless, holistic, digital transformation, streamline, unlock, scalable, future-proof, world-class, game-changer, best-in-class, top-notch, cutting-edge, next-gen
- Never open with: "I hope this finds you well", "I wanted to reach out", "Just checking in", "I noticed you...", "Circle back", "Touch base", "Quick question"
- Never pitch "optimize your funnel", "lead generation ecosystem", "grow your business" (vague)
- Write like you'd TEXT a friend's dad. Not like you'd email a CEO.
- Short sentences when the point is strong. No em-dashes.
- Respect the owner's time — they read this between jobs.

## Structure That Works
1. Open with a concrete observation about THEIR business (one of their specificHooks — quote verbatim)
2. Name a specific problem or missed opportunity (from painPointSignals or industry knowledge)
3. Say what you'd do in one line
4. Drop the {{SITE_URL}} placeholder — "here's what it could look like: {{SITE_URL}}"
5. Low-commitment close: no "let's jump on a 30-min call" — just "if that's useful, let me know"

## HumanScore
Self-score two axes (0-10):
- personalizationDepthScore: how specifically personalized is this to THIS business vs. any other plumber/cleaner/etc.?
- conversationalToneScore: how naturally conversational vs. how robotic?

humanScore = MIN(personalizationDepthScore, conversationalToneScore). This is the floor — weak axis drags the whole draft. The validator double-checks this math.

## Rules
- Exactly ONE {{SITE_URL}}. Not zero. Not two. Literal string.
- At least one verbatim quote from specificHooks.
- 50 ≤ word count ≤ 100.
- channel = "linkedin_dm" (no Subject line, no formal salutation)
- If humanScore < 7 on your own self-rating, you're producing a weak draft. Reconsider before calling the tool.`;

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    // 1. startInFlight BEFORE any work.
    const actionId: Id<"agentActions"> = await ctx.runMutation(
      internal.agentActions.startInFlight,
      {
        agentName: "han",
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
      if (!prospect) throw new Error(`Prospect ${args.prospectId} not found`);
      if (!prospect.specificHooks || prospect.specificHooks.length === 0) {
        throw new Error(
          `Prospect ${args.prospectId} has empty specificHooks — Han needs at least one verbatim quote to cite`,
        );
      }

      // 3. Compose user message. If leiaOutput is present, include brand brief
      //    for tone hints — makes Han's draft align with the site Chewie will
      //    eventually build.
      const brandHint =
        prospect.leiaOutput && typeof prospect.leiaOutput === "object"
          ? `\n## Brand Brief (from Leia)\n${JSON.stringify((prospect.leiaOutput as any).brand ?? {}, null, 2)}\n`
          : "";

      const contextBlob = [
        "## Prospect",
        `Business: ${prospect.businessName}`,
        `Industry: ${prospect.industry}`,
        `Market: ${prospect.market}`,
        `Website: ${prospect.websiteDomain}`,
        `LinkedIn: ${prospect.linkedinProfileUrl ?? "unknown"}`,
        "",
        "## specificHooks (CITE AT LEAST ONE VERBATIM)",
        ...prospect.specificHooks.map((h: string, i: number) => `${i + 1}. ${h}`),
        brandHint,
        "",
        "Write ONE LinkedIn DM following all rules. Call submit_outreach.",
      ].join("\n");

      // 4. Claude call — structured output mode (no executors).
      const result = await callAgent({
        ctx,
        agentName: "han",
        system: HAN_SYSTEM_PROMPT,
        messages: [{ role: "user", content: contextBlob }],
        tools: [outreachSchema as any],
        toolChoice: { type: "tool", name: outreachSchema.name },
        runId: args.runId,
        prospectId: args.prospectId,
      });

      const draft = result.toolUseResults[0]?.input as
        | {
            channel: "linkedin_dm";
            body: string;
            personalizationHooks: string[];
            personalizationDepthScore: number;
            conversationalToneScore: number;
            humanScore: number;
            humanScoreReason: string;
          }
        | undefined;
      if (!draft) throw new Error("Han: no tool_use in Claude response");

      // 5. Deterministic post-call validation — HAN-04 + HAN-05.
      const validation = validateHanDraft(
        {
          body: draft.body,
          humanScore: draft.humanScore,
          personalizationDepthScore: draft.personalizationDepthScore,
          conversationalToneScore: draft.conversationalToneScore,
        },
        prospect.specificHooks,
      );

      if (!validation.ok) {
        // Validator rejected — mark needs_manual_review, do NOT write the draft.
        await ctx.runMutation(internal.prospects.patch, {
          id: args.prospectId,
          status: "needs_manual_review",
          rejectionReason: `han_validator: ${validation.reason ?? "unknown"}`,
        });
        await ctx.runMutation(internal.agentActions.complete, {
          id: actionId,
          // IMPORTANT: validator rejection is SUCCESS (Han did her job — the
          // constraint system caught a bad draft). "failed" is reserved for
          // Claude/Convex/network errors.
          status: "success",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          finishedAt: Date.now(),
        });
        return {
          ok: false,
          rejected: validation.reason,
          prospectId: args.prospectId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        };
      }

      // 6. Validator passed — write hanDraft + humanScore. Do NOT transition
      //    prospect status — approval-queue lifecycle is Phase 6+ wiring.
      await ctx.runMutation(internal.prospects.patch, {
        id: args.prospectId,
        hanDraft: draft.body,
        humanScore: draft.humanScore,
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
        humanScore: draft.humanScore,
        body: draft.body,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
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

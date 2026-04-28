"use node";
import { v } from "convex/values";
import { action, internalAction, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";

/**
 * Phase 6 — daily pipeline orchestrator.
 *
 * runDaily is PUBLIC (action) — both the 6am ET cron and the dashboard
 * "Run now" button call it via api.pipeline.runDaily. Three-layer pause/cost
 * guard:
 *   1. runDaily before R2: re-entrancy + paused + dailyCostCeiling
 *   2. processProspect before agent chain: paused + dailyCostCeiling
 *   3. callAgent (pre-existing): per-run cost ceiling
 *
 * Fan-out pattern: R2 runs inline (one ~30s call), then per-prospect work is
 * scheduled via ctx.scheduler.runAfter(0, processProspect, ...) — NEVER via
 * ctx.runAction(internal.pipeline.processProspect, ...). The latter would
 * block the orchestrator past the 10-min Convex action limit. Concurrency=2
 * is enforced by scheduling the first 2 prospects, then each prospect on
 * completion schedules exactly one more from the rest queue.
 *
 * Failure isolation: processProspect uses try/catch/finally, and the finally
 * ALWAYS schedules the next prospect. A single prospect's failure cannot stop
 * the pipeline. After 3 retries (incrementRetry → markedFailed=true), a
 * Telegram alert fires and that prospect's status flips to "failed".
 *
 * Quality gate: applyQualityGate reads ahsokaReview.verdict directly from the
 * prospect doc (NOT prospect.status — Han may have left it as "site_built"
 * even when Ahsoka rejected). Rejection paths: ahsoka_rejected, han_low_score
 * (humanScore < 7), send_cap (daily cap reached → needs_manual_review).
 */

// PUBLIC action — callable by cron (api.pipeline.runDaily) AND dashboard button.
export const runDaily = action({
  args: {
    triggeredBy: v.union(v.literal("cron"), v.literal("manual")),
    market: v.optional(v.string()),
    niche: v.optional(v.string()),
    targetCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { triggeredBy, market, niche, targetCount } = args;

    // GATE 1: Re-entrancy guard — transactional, prevents duplicate runs.
    const { runId, alreadyActive } = await ctx.runMutation(
      internal.runs.createIfNotActive,
      { triggeredBy },
    );
    if (!runId) {
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "warning",
        title: "Pipeline run already active — skipping",
        body: `Run ${alreadyActive} is still in flight. New trigger ignored.`,
      });
      return { runId: null, status: "skipped_already_running" as const };
    }

    // GATE 2: Pause check.
    const ceiling = await ctx.runQuery(
      internal.agentActions.getCeilingState,
      { runId },
    );
    if (ceiling.paused) {
      await ctx.runMutation(internal.runs.complete, {
        id: runId,
        status: "paused",
      });
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "warning",
        title: "Pipeline paused — skipping run",
        body: "pipelineControl.paused=true. No prospects will be processed.",
      });
      return { runId, status: "skipped_paused" as const };
    }

    // GATE 3: Daily cost ceiling.
    if (ceiling.dailyCostSoFar >= ceiling.dailyCostCeilingUsd) {
      await ctx.runMutation(internal.runs.complete, {
        id: runId,
        status: "failed",
      });
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "error",
        title: "Daily cost ceiling hit — skipping run",
        body: `Daily cost: $${ceiling.dailyCostSoFar.toFixed(2)} / $${ceiling.dailyCostCeilingUsd}. Skipping today.`,
      });
      return { runId, status: "skipped_cost_ceiling" as const };
    }

    // R2 runs inline — single prospecting call, fits in orchestrator's time budget.
    try {
      await ctx.runAction(internal.agents.r2.run, {
        runId,
        market: market ?? "Boise, ID",
        niche: niche ?? "plumber",
        targetCount: targetCount ?? 5,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.errorLog.insert, {
        runId,
        agentName: "r2",
        message: msg,
        stack: err instanceof Error ? err.stack : undefined,
        severity: "error",
        createdAt: Date.now(),
      });
      await ctx.runMutation(internal.runs.complete, {
        id: runId,
        status: "failed",
      });
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "error",
        title: "R2 prospecting failed — run aborted",
        body: msg,
      });
      return { runId, status: "failed_r2" as const };
    }

    // Pull prospects R2 just inserted for this run.
    const prospects = await ctx.runQuery(internal.prospects.listByRun, {
      runId,
    });
    await ctx.runMutation(internal.runs.update, {
      id: runId,
      prospectsFound: prospects.length,
    });

    if (prospects.length === 0) {
      await ctx.scheduler.runAfter(0, internal.pipeline.finalizeRun, { runId });
      return { runId, status: "running" as const, prospectCount: 0 };
    }

    // Fire-and-forget Telegram: run started.
    await ctx.runAction(internal.lib.telegram.sendTelegram, {
      character: "C-3PO",
      level: "info",
      title: `Run started (${triggeredBy})`,
      body: `R2 found ${prospects.length} prospects. Concurrency=2.`,
    });

    // Schedule first 2 prospects — each one schedules the next on completion (concurrency=2).
    const queue = prospects.map((p) => p._id);
    await ctx.runMutation(internal.pipeline.scheduleNextChunk, {
      runId,
      queue,
      concurrency: 2,
    });

    return {
      runId,
      status: "running" as const,
      prospectCount: prospects.length,
    };
  },
});

// Schedules up to `concurrency` prospect actions; if queue is empty, fires finalizer.
export const scheduleNextChunk = internalMutation({
  args: {
    runId: v.id("runs"),
    queue: v.array(v.id("prospects")),
    concurrency: v.number(),
  },
  handler: async (ctx, { runId, queue, concurrency }) => {
    const chunk = queue.slice(0, concurrency);
    const rest = queue.slice(concurrency);
    for (const prospectId of chunk) {
      await ctx.scheduler.runAfter(0, internal.pipeline.processProspect, {
        runId,
        prospectId,
        queue: rest,
      });
    }
    if (chunk.length === 0) {
      await ctx.scheduler.runAfter(0, internal.pipeline.finalizeRun, { runId });
    }
  },
});

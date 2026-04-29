import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

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
    // Explicit annotation breaks the circular type inference (see STATE.md
    // 03-03 invariant: any ctx.runMutation returning Id<"table"> may hit TS7022).
    const reentry: {
      runId: Id<"runs"> | null;
      alreadyActive: Id<"runs"> | null;
    } = await ctx.runMutation(internal.runs.createIfNotActive, {
      triggeredBy,
    });
    const { runId, alreadyActive } = reentry;
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
    const prospects: Doc<"prospects">[] = await ctx.runQuery(
      internal.prospects.listByRun,
      { runId },
    );
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

// ---------------------------------------------------------------------------
// Internal helpers — quality gate + failure handling
// ---------------------------------------------------------------------------

async function applyQualityGate(
  ctx: ActionCtx,
  prospectId: Id<"prospects">,
): Promise<{ queued: boolean; reason?: string }> {
  // Read current prospect state — Ahsoka and Han have updated it.
  const prospect = await ctx.runQuery(internal.prospects.get, {
    id: prospectId,
  });
  if (!prospect) throw new Error(`Prospect ${prospectId} disappeared`);

  // Hard reject: Ahsoka verdict.
  if (prospect.ahsokaReview?.verdict === "rejected") {
    await ctx.runMutation(internal.prospects.patch, {
      id: prospectId,
      status: "rejected",
      rejectionReason: prospect.rejectionReason ?? "ahsoka_rejected",
    });
    return { queued: false, reason: "ahsoka_rejected" };
  }

  // Hard reject: Han humanScore < 7.
  if (
    typeof prospect.humanScore !== "number" ||
    prospect.humanScore < 7
  ) {
    await ctx.runMutation(internal.prospects.patch, {
      id: prospectId,
      status: "rejected",
      rejectionReason: `han_humanScore_low (${prospect.humanScore ?? "missing"})`,
    });
    return { queued: false, reason: "han_low_score" };
  }

  // Daily send-cap enforcement (independent of quality).
  const todayCount = await ctx.runQuery(
    internal.approvalQueue.countToday,
    {},
  );
  const control = await ctx.runQuery(api.pipelineControl.get, {});
  if (todayCount >= control.dailySendCap) {
    await ctx.runMutation(internal.prospects.patch, {
      id: prospectId,
      status: "needs_manual_review",
      rejectionReason: `daily_send_cap_reached (${todayCount}/${control.dailySendCap})`,
    });
    return { queued: false, reason: "send_cap" };
  }

  // Passes all gates — add to approval queue.
  await ctx.runMutation(internal.approvalQueue.add, {
    prospectId,
    queuedAt: Date.now(),
  });
  await ctx.runMutation(internal.prospects.patch, {
    id: prospectId,
    status: "approved",
  });
  return { queued: true };
}

async function handleProspectFailure(
  ctx: ActionCtx,
  prospectId: Id<"prospects">,
  runId: Id<"runs">,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  await ctx.runMutation(internal.errorLog.insert, {
    prospectId,
    runId,
    agentName: "pipeline",
    message,
    stack,
    severity: "error",
    createdAt: Date.now(),
  });

  await ctx.runMutation(internal.runs.incrementErrorCount, { id: runId });

  const result = await ctx.runMutation(internal.prospects.incrementRetry, {
    id: prospectId,
  });
  if (result.markedFailed) {
    await ctx.runAction(internal.lib.telegram.sendTelegram, {
      character: "C-3PO",
      level: "error",
      title: "Prospect failed after 3 attempts",
      body: `Prospect ${prospectId}: ${message}\n\nI'm terribly sorry, but this prospect has exceeded the retry limit.`,
    });
  }
}

// Per-prospect action — full agent chain with failure isolation.
export const processProspect = internalAction({
  args: {
    runId: v.id("runs"),
    prospectId: v.id("prospects"),
    queue: v.array(v.id("prospects")),
  },
  handler: async (ctx, { runId, prospectId, queue }) => {
    try {
      // LAYER 2 OF 3: Per-prospect pause/cost guard (before any Claude call).
      const ceiling = await ctx.runQuery(
        internal.agentActions.getCeilingState,
        { runId },
      );
      if (ceiling.paused) {
        await ctx.runMutation(internal.prospects.patch, {
          id: prospectId,
          status: "failed",
          rejectionReason: "pipeline_paused_during_run",
        });
        return;
      }
      if (ceiling.dailyCostSoFar >= ceiling.dailyCostCeilingUsd) {
        await ctx.runMutation(internal.prospects.patch, {
          id: prospectId,
          status: "failed",
          rejectionReason: "daily_cost_ceiling_breached",
        });
        return;
      }

      // Full agent chain — sequential awaits inside try block.
      // Layer 3 of pause/cost guard lives inside callAgent (already implemented).
      await ctx.runAction(internal.agents.leia.run, { prospectId, runId });
      await ctx.runAction(internal.agents.chewie.run, { prospectId, runId });
      await ctx.runAction(internal.agents.luke.run, { prospectId, runId });

      // Ahsoka requires siteUrl — fetch from prospect (Chewie set it during deploy).
      const prospect = await ctx.runQuery(internal.prospects.get, {
        id: prospectId,
      });
      if (!prospect) throw new Error(`Prospect ${prospectId} disappeared`);
      if (!prospect.siteUrl) {
        throw new Error(
          `Prospect ${prospectId} has no siteUrl after Chewie/Luke — cannot run Ahsoka`,
        );
      }
      await ctx.runAction(internal.agents.ahsoka.run, {
        prospectId,
        runId,
        siteUrl: prospect.siteUrl,
      });
      await ctx.runAction(internal.agents.han.run, { prospectId, runId });

      // Quality gate — inserts into approvalQueue only if all criteria pass.
      const gate = await applyQualityGate(ctx, prospectId);
      if (gate.queued) {
        await ctx.runMutation(internal.runs.incrementSitesBuilt, {
          id: runId,
        });
      }
    } catch (err) {
      await handleProspectFailure(ctx, prospectId, runId, err);
    } finally {
      // ALWAYS schedule next — failure isolation (a failing prospect cannot block others).
      if (queue.length > 0) {
        const [nextProspectId, ...rest] = queue;
        await ctx.scheduler.runAfter(0, internal.pipeline.processProspect, {
          runId,
          prospectId: nextProspectId,
          queue: rest,
        });
      } else {
        // Last prospect in this lane — check if the other lane is also done.
        await ctx.scheduler.runAfter(0, internal.pipeline.checkRunComplete, {
          runId,
        });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Run finalization
// ---------------------------------------------------------------------------

// Called by last prospect in each lane — checks if all prospects are terminal.
export const checkRunComplete = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const prospects: Doc<"prospects">[] = await ctx.runQuery(
      internal.prospects.listByRun,
      { runId },
    );
    const TERMINAL = new Set([
      "approved",
      "rejected",
      "failed",
      "needs_manual_review",
    ]);
    const allDone = prospects.every((p) => TERMINAL.has(p.status));
    if (allDone) {
      await ctx.scheduler.runAfter(0, internal.pipeline.finalizeRun, { runId });
    }
  },
});

// Closes out a run — idempotent (safe to call twice).
export const finalizeRun = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(api.runs.getById, { id: runId });
    if (!run) return;
    if (run.status !== "running") return; // already finalized

    const prospects: Doc<"prospects">[] = await ctx.runQuery(
      internal.prospects.listByRun,
      { runId },
    );
    const approvedCount = prospects.filter(
      (p) => p.status === "approved",
    ).length;
    const failedCount = prospects.filter(
      (p) => p.status === "failed",
    ).length;
    const rejectedCount = prospects.filter(
      (p) => p.status === "rejected",
    ).length;

    let finalStatus: "completed" | "failed" | "partial";
    if (prospects.length === 0) {
      finalStatus = "completed";
    } else if (failedCount === prospects.length) {
      finalStatus = "failed";
    } else if (approvedCount === prospects.length) {
      finalStatus = "completed";
    } else {
      finalStatus = "partial";
    }

    const ceiling = await ctx.runQuery(
      internal.agentActions.getCeilingState,
      { runId },
    );
    await ctx.runMutation(internal.runs.complete, {
      id: runId,
      status: finalStatus,
      totalCostUsd: ceiling.runCostSoFar,
    });

    await ctx.runAction(internal.lib.telegram.sendTelegram, {
      character: "Yoda",
      level: finalStatus === "completed" ? "success" : "warning",
      title: `Run finished — ${finalStatus}`,
      body: `Prospects: ${prospects.length}\nApproved: ${approvedCount}\nRejected: ${rejectedCount}\nFailed: ${failedCount}\nCost: $${ceiling.runCostSoFar.toFixed(2)}`,
    });
  },
});

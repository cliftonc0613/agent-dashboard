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
 * Each agent runs in its own scheduled internalAction so no single action
 * approaches the 10-min Convex limit. The chain:
 *
 *   runDaily → scheduleNextChunk → runLeia → runChewie → runLuke
 *           → runAhsoka → runHan → applyQualityGate → scheduleNext
 *
 * Concurrency=2: scheduleNextChunk fires first 2; each last agent schedules
 * one more from the rest queue.
 *
 * Three-layer pause/cost guard:
 *   1. runDaily before R2 — re-entrancy + paused + dailyCostCeiling
 *   2. runLeia before any Claude call — paused + dailyCostCeiling
 *   3. callAgent (pre-existing) — per-run cost ceiling
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const PROSPECT_ARGS = {
  runId: v.id("runs"),
  prospectId: v.id("prospects"),
  queue: v.array(v.id("prospects")),
};

async function checkCeiling(
  ctx: ActionCtx,
  runId: Id<"runs">,
): Promise<{ blocked: boolean; reason?: string }> {
  const ceiling = await ctx.runQuery(
    internal.agentActions.getCeilingState,
    { runId },
  );
  if (ceiling.paused) return { blocked: true, reason: "paused" };
  if (ceiling.dailyCostSoFar >= ceiling.dailyCostCeilingUsd)
    return { blocked: true, reason: "daily_cost_ceiling" };
  return { blocked: false };
}

async function scheduleNext(
  ctx: ActionCtx,
  runId: Id<"runs">,
  queue: Id<"prospects">[],
): Promise<void> {
  if (queue.length > 0) {
    const [nextProspectId, ...rest] = queue;
    await ctx.scheduler.runAfter(0, internal.pipeline.runLeia, {
      runId,
      prospectId: nextProspectId,
      queue: rest,
    });
  } else {
    await ctx.scheduler.runAfter(0, internal.pipeline.checkRunComplete, {
      runId,
    });
  }
}

async function applyQualityGate(
  ctx: ActionCtx,
  prospectId: Id<"prospects">,
): Promise<{ queued: boolean; reason?: string }> {
  const prospect = await ctx.runQuery(internal.prospects.get, {
    id: prospectId,
  });
  if (!prospect) throw new Error(`Prospect ${prospectId} disappeared`);

  if (prospect.ahsokaReview?.verdict === "rejected") {
    await ctx.runMutation(internal.prospects.patch, {
      id: prospectId,
      status: "rejected",
      rejectionReason: prospect.rejectionReason ?? "ahsoka_rejected",
    });
    return { queued: false, reason: "ahsoka_rejected" };
  }

  if (typeof prospect.humanScore !== "number" || prospect.humanScore < 7) {
    await ctx.runMutation(internal.prospects.patch, {
      id: prospectId,
      status: "rejected",
      rejectionReason: `han_humanScore_low (${prospect.humanScore ?? "missing"})`,
    });
    return { queued: false, reason: "han_low_score" };
  }

  const todayCount = await ctx.runQuery(internal.approvalQueue.countToday, {});
  const control = await ctx.runQuery(api.pipelineControl.get, {});
  if (todayCount >= control.dailySendCap) {
    await ctx.runMutation(internal.prospects.patch, {
      id: prospectId,
      status: "needs_manual_review",
      rejectionReason: `daily_send_cap_reached (${todayCount}/${control.dailySendCap})`,
    });
    return { queued: false, reason: "send_cap" };
  }

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
      body: `Prospect ${prospectId}: ${message}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const runDaily = action({
  args: {
    triggeredBy: v.union(v.literal("cron"), v.literal("manual")),
    market: v.optional(v.string()),
    niche: v.optional(v.string()),
    targetCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { triggeredBy, market, niche, targetCount } = args;

    const reentry: {
      runId: Id<"runs"> | null;
      alreadyActive: Id<"runs"> | null;
    } = await ctx.runMutation(internal.runs.createIfNotActive, { triggeredBy });
    const { runId, alreadyActive } = reentry;
    if (!runId) {
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "warning",
        title: "Pipeline run already active — skipping",
        body: `Run ${alreadyActive} is still in flight.`,
      });
      return { runId: null, status: "skipped_already_running" as const };
    }

    const ceiling = await ctx.runQuery(
      internal.agentActions.getCeilingState,
      { runId },
    );
    if (ceiling.paused) {
      await ctx.runMutation(internal.runs.complete, { id: runId, status: "paused" });
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "warning",
        title: "Pipeline paused — skipping run",
        body: "pipelineControl.paused=true. No prospects will be processed.",
      });
      return { runId, status: "skipped_paused" as const };
    }

    if (ceiling.dailyCostSoFar >= ceiling.dailyCostCeilingUsd) {
      await ctx.runMutation(internal.runs.complete, { id: runId, status: "failed" });
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "error",
        title: "Daily cost ceiling hit — skipping run",
        body: `Daily cost: $${ceiling.dailyCostSoFar.toFixed(2)} / $${ceiling.dailyCostCeilingUsd}.`,
      });
      return { runId, status: "skipped_cost_ceiling" as const };
    }

    try {
      await ctx.runAction(internal.agents.r2.run, {
        runId,
        market: market ?? "Greenville, SC",
        niche: niche ?? "landscaper",
        targetCount: targetCount ?? 4,
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
      await ctx.runMutation(internal.runs.complete, { id: runId, status: "failed" });
      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "C-3PO",
        level: "error",
        title: "R2 prospecting failed — run aborted",
        body: msg,
      });
      return { runId, status: "failed_r2" as const };
    }

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

    await ctx.runAction(internal.lib.telegram.sendTelegram, {
      character: "C-3PO",
      level: "info",
      title: `Run started (${triggeredBy})`,
      body: `R2 found ${prospects.length} prospects. Concurrency=2.`,
    });

    const queue = prospects.map((p) => p._id);
    await ctx.runMutation(internal.pipeline.scheduleNextChunk, {
      runId,
      queue,
      concurrency: 2,
    });

    return { runId, status: "running" as const, prospectCount: prospects.length };
  },
});

// Schedules first N prospects from queue as runLeia actions.
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
      await ctx.scheduler.runAfter(0, internal.pipeline.runLeia, {
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
// Per-agent steps — each is its own scheduled action (~2-3 min budget each)
// ---------------------------------------------------------------------------

export const runLeia = internalAction({
  args: PROSPECT_ARGS,
  handler: async (ctx, { runId, prospectId, queue }) => {
    let succeeded = false;
    try {
      const gate = await checkCeiling(ctx, runId);
      if (gate.blocked) {
        await ctx.runMutation(internal.prospects.patch, {
          id: prospectId,
          status: "failed",
          rejectionReason: gate.reason,
        });
        return;
      }
      await ctx.runAction(internal.agents.leia.run, { prospectId, runId });
      succeeded = true;
    } catch (err) {
      await handleProspectFailure(ctx, prospectId, runId, err);
    } finally {
      if (succeeded) {
        await ctx.scheduler.runAfter(0, internal.pipeline.runChewie, {
          runId, prospectId, queue,
        });
      } else {
        await scheduleNext(ctx, runId, queue);
      }
    }
  },
});

export const runChewie = internalAction({
  args: PROSPECT_ARGS,
  handler: async (ctx, { runId, prospectId, queue }) => {
    let succeeded = false;
    try {
      await ctx.runAction(internal.agents.chewie.run, { prospectId, runId });
      succeeded = true;
    } catch (err) {
      await handleProspectFailure(ctx, prospectId, runId, err);
    } finally {
      if (succeeded) {
        await ctx.scheduler.runAfter(0, internal.pipeline.runLuke, {
          runId, prospectId, queue,
        });
      } else {
        await scheduleNext(ctx, runId, queue);
      }
    }
  },
});

export const runLuke = internalAction({
  args: PROSPECT_ARGS,
  handler: async (ctx, { runId, prospectId, queue }) => {
    let succeeded = false;
    try {
      await ctx.runAction(internal.agents.luke.run, { prospectId, runId });
      succeeded = true;
    } catch (err) {
      await handleProspectFailure(ctx, prospectId, runId, err);
    } finally {
      if (succeeded) {
        await ctx.scheduler.runAfter(0, internal.pipeline.runAhsoka, {
          runId, prospectId, queue,
        });
      } else {
        await scheduleNext(ctx, runId, queue);
      }
    }
  },
});

export const runAhsoka = internalAction({
  args: PROSPECT_ARGS,
  handler: async (ctx, { runId, prospectId, queue }) => {
    let succeeded = false;
    try {
      const prospect = await ctx.runQuery(internal.prospects.get, { id: prospectId });
      if (!prospect) throw new Error(`Prospect ${prospectId} disappeared`);
      if (!prospect.siteUrl) {
        throw new Error(`Prospect ${prospectId} has no siteUrl after Luke — cannot run Ahsoka`);
      }
      await ctx.runAction(internal.agents.ahsoka.run, {
        prospectId,
        runId,
        siteUrl: prospect.siteUrl,
      });
      succeeded = true;
    } catch (err) {
      await handleProspectFailure(ctx, prospectId, runId, err);
    } finally {
      if (succeeded) {
        await ctx.scheduler.runAfter(0, internal.pipeline.runHan, {
          runId, prospectId, queue,
        });
      } else {
        await scheduleNext(ctx, runId, queue);
      }
    }
  },
});

export const runHan = internalAction({
  args: PROSPECT_ARGS,
  handler: async (ctx, { runId, prospectId, queue }) => {
    try {
      await ctx.runAction(internal.agents.han.run, { prospectId, runId });
      const gate = await applyQualityGate(ctx, prospectId);
      if (gate.queued) {
        await ctx.runMutation(internal.runs.incrementSitesBuilt, { id: runId });
      }
    } catch (err) {
      await handleProspectFailure(ctx, prospectId, runId, err);
    } finally {
      await scheduleNext(ctx, runId, queue);
    }
  },
});

// ---------------------------------------------------------------------------
// Run finalization
// ---------------------------------------------------------------------------

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

export const finalizeRun = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(api.runs.getById, { id: runId });
    if (!run) return;
    if (run.status !== "running") return;

    const prospects: Doc<"prospects">[] = await ctx.runQuery(
      internal.prospects.listByRun,
      { runId },
    );
    const approvedCount = prospects.filter((p) => p.status === "approved").length;
    const failedCount = prospects.filter((p) => p.status === "failed").length;
    const rejectedCount = prospects.filter((p) => p.status === "rejected").length;

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

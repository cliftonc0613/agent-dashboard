import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * agentActions — write-before-read logging primitives for the callAgent wrapper.
 *
 * The wrapper (implemented in wave 2, plan 03-02) follows this sequence on
 * every Claude invocation:
 *
 *   1. startInFlight({ agentName, prospectId?, runId?, model, startedAt })
 *        → inserts a row with status="in_flight" and returns its _id
 *   2. (LLM call happens here — may succeed, fail, or hit a cost ceiling)
 *   3. complete({ id, status, inputTokens, outputTokens, costUsd, finishedAt })
 *        → patches the row with terminal status and token/cost accounting
 *      OR
 *      fail({ id, errorMessage, finishedAt })
 *        → convenience wrapper that sets status="failed" on exception paths
 *
 * This insert-first-patch-later split satisfies the INFRA-02 success criterion
 * (in_flight row appears BEFORE the Claude call, then updates to terminal
 * status on completion) — it guarantees that a crash mid-call still leaves a
 * traceable row in the DB.
 *
 * getCeilingState is the pre-flight check the wrapper consults to decide
 * whether to make the call at all — returns the kill switch, both ceilings,
 * and the current run-level + daily cost totals in a single query.
 *
 * All four exports are internal — public dashboard queries live elsewhere
 * (Phase 9). Default runtime intentionally: these are pure DB operations with
 * no Node built-ins or third-party SDK imports, so they stay cheap to call
 * via ctx.runQuery / ctx.runMutation from Node-runtime actions.
 */

export const startInFlight = internalMutation({
  args: {
    agentName: v.string(),
    prospectId: v.optional(v.id("prospects")),
    runId: v.optional(v.id("runs")),
    model: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentActions", {
      ...args,
      status: "in_flight",
    });
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("agentActions"),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("cost_ceiling_hit"),
    ),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    finishedAt: v.number(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

export const fail = internalMutation({
  args: {
    id: v.id("agentActions"),
    errorMessage: v.string(),
    finishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      errorMessage: args.errorMessage,
      finishedAt: args.finishedAt,
    });
  },
});

export const getCeilingState = internalQuery({
  args: {
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, { runId }) => {
    const control = await ctx.db.query("pipelineControl").first();

    let runCostSoFar = 0;
    if (runId !== undefined) {
      const runRows = await ctx.db
        .query("agentActions")
        .withIndex("by_runId", (q) => q.eq("runId", runId))
        .collect();
      runCostSoFar = runRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const dailyRows = await ctx.db
      .query("agentActions")
      .filter((q) => q.gte(q.field("_creationTime"), startOfDay.getTime()))
      .collect();
    const dailyCostSoFar = dailyRows.reduce(
      (sum, row) => sum + (row.costUsd ?? 0),
      0,
    );

    return {
      paused: control?.paused ?? true,
      dailyCostCeilingUsd: control?.dailyCostCeilingUsd ?? 10,
      perRunCostCeilingUsd: control?.perRunCostCeilingUsd ?? 5,
      runCostSoFar,
      dailyCostSoFar,
    };
  },
});

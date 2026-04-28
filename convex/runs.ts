/**
 * Phase 6 — runs lifecycle module.
 *
 * The pipeline orchestrator (convex/pipeline.ts, Plan 06-02) composes these
 * primitives. Every daily 6am ET cron tick begins by calling `createIfNotActive`
 * (re-entrancy guard) and ends by calling `complete`. Per-prospect failures
 * call `incrementErrorCount`; quality-gate passes call `incrementSitesBuilt`.
 *
 * createIfNotActive is the safety primitive: if a run is already in `running`
 * status and started <30 min ago, no new run is created. If a stale run is
 * found (>30 min), it's marked failed and a fresh run is created. This matches
 * the expected real-world ceiling: pipeline runs to completion in ~10 min, so
 * 30 min is 3x buffer for legitimately long runs while still catching crashes.
 */

import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

const runStatusUnion = v.union(
  v.literal("completed"),
  v.literal("failed"),
  v.literal("partial"),
  v.literal("paused"),
);

export const create = internalMutation({
  args: {
    triggeredBy: v.union(v.literal("cron"), v.literal("manual")),
  },
  handler: async (ctx, { triggeredBy }) => {
    return await ctx.db.insert("runs", {
      startedAt: Date.now(),
      status: "running",
      prospectsFound: 0,
      sitesBuilt: 0,
      totalCostUsd: 0,
      errorCount: 0,
      triggeredBy,
    });
  },
});

export const createIfNotActive = internalMutation({
  args: {
    triggeredBy: v.union(v.literal("cron"), v.literal("manual")),
  },
  handler: async (ctx, { triggeredBy }) => {
    const active = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .first();

    if (active) {
      const age = Date.now() - active.startedAt;
      if (age < STALE_THRESHOLD_MS) {
        // Active run is still legitimate — refuse to create a duplicate.
        return { runId: null, alreadyActive: active._id };
      }
      // Stale run — mark failed and clear the way for a new one.
      await ctx.db.patch(active._id, {
        status: "failed",
        finishedAt: Date.now(),
      });
    }

    const runId = await ctx.db.insert("runs", {
      startedAt: Date.now(),
      status: "running",
      prospectsFound: 0,
      sitesBuilt: 0,
      totalCostUsd: 0,
      errorCount: 0,
      triggeredBy,
    });
    return { runId, alreadyActive: null };
  },
});

export const update = internalMutation({
  args: {
    id: v.id("runs"),
    prospectsFound: v.optional(v.number()),
    sitesBuilt: v.optional(v.number()),
    totalCostUsd: v.optional(v.number()),
    errorCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch);
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("runs"),
    status: runStatusUnion,
    totalCostUsd: v.optional(v.number()),
  },
  handler: async (ctx, { id, status, totalCostUsd }) => {
    const patch: Record<string, unknown> = {
      status,
      finishedAt: Date.now(),
    };
    if (totalCostUsd !== undefined) patch.totalCostUsd = totalCostUsd;
    await ctx.db.patch(id, patch);
  },
});

export const getActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .first();
  },
});

// PUBLIC — dashboard reads this via useQuery to render run progress.
export const getById = query({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const incrementErrorCount = internalMutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    if (!run) throw new Error(`Run ${id} not found`);
    await ctx.db.patch(id, { errorCount: run.errorCount + 1 });
  },
});

export const incrementSitesBuilt = internalMutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    if (!run) throw new Error(`Run ${id} not found`);
    await ctx.db.patch(id, { sitesBuilt: run.sitesBuilt + 1 });
  },
});

/**
 * Phase 6 — pipelineControl singleton accessors.
 *
 * The dashboard's kill-switch button hits `pause`/`resume`. The orchestrator
 * (convex/pipeline.ts) reads `get` on every cron tick and refuses to start a
 * new run when `paused === true`. The optional `pausedReason` is recorded so
 * the morning briefing (Yoda, Phase 7) can surface WHY the pipeline halted.
 *
 * Singleton invariant: exactly one row exists, seeded by initPipelineControl
 * on first deploy. Throws if missing — that's a deploy bug, not a runtime
 * condition.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// PUBLIC — dashboard reads via useQuery.
export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("pipelineControl").first();
    if (!row) {
      throw new Error(
        "pipelineControl singleton missing — run initPipelineControl seed.",
      );
    }
    return row;
  },
});

// PUBLIC — dashboard kill-switch button.
export const pause = mutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, { reason }) => {
    const row = await ctx.db.query("pipelineControl").first();
    if (!row) {
      throw new Error(
        "pipelineControl singleton missing — run initPipelineControl seed.",
      );
    }
    await ctx.db.patch(row._id, { paused: true, pausedReason: reason });
  },
});

// PUBLIC — dashboard resume button.
export const resume = mutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("pipelineControl").first();
    if (!row) {
      throw new Error(
        "pipelineControl singleton missing — run initPipelineControl seed.",
      );
    }
    await ctx.db.patch(row._id, { paused: false, pausedReason: undefined });
  },
});

/**
 * Phase 6 — approvalQueue accessors.
 *
 * After Ahsoka approves a site AND Han's draft passes the humanity score gate,
 * the orchestrator calls `add` to enqueue the prospect for human review. The
 * /approvals dashboard reads `listPending` to render the review queue. Daily
 * send-cap enforcement uses `countToday` to refuse new enqueues once the cap
 * is hit.
 *
 * Note: verdict mutation (approve/reject) lives in a separate handler; this
 * module only owns the queue's enqueue + read paths used by the orchestrator.
 */

import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { v } from "convex/values";

export const add = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    queuedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("approvalQueue", args);
  },
});

export const countToday = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();

    const rowsToday = await ctx.db
      .query("approvalQueue")
      .filter((q) => q.gte(q.field("_creationTime"), startOfDay))
      .collect();

    return rowsToday.length;
  },
});

// PUBLIC — /approvals dashboard reads via useQuery.
export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("approvalQueue").collect();
    return rows
      .filter((r) => r.verdict === undefined)
      .sort((a, b) => a.queuedAt - b.queuedAt);
  },
});

import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * triggers — public mutations the dashboard calls to schedule each agent.
 *
 * Every runAfter call MUST be awaited — scheduler.runAfter returns a promise,
 * and not awaiting it breaks the transactional guarantee.
 */

export const triggerR2 = mutation({
  args: {
    market: v.string(),
    niche: v.string(),
    targetCount: v.number(),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.agents.r2.run, args);
    return { scheduled: true };
  },
});

export const triggerLeia = mutation({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.agents.leia.run, args);
    return { scheduled: true };
  },
});

export const triggerAhsoka = mutation({
  args: {
    prospectId: v.id("prospects"),
    siteUrl: v.string(),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.agents.ahsoka.run, args);
    return { scheduled: true };
  },
});

export const triggerHan = mutation({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.agents.han.run, args);
    return { scheduled: true };
  },
});

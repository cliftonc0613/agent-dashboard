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

export const triggerChewie = mutation({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.agents.chewie.run, args);
    return { scheduled: true };
  },
});

export const resetLuke = mutation({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args) => {
    const prospect = await ctx.db.get(args.prospectId);
    if (!prospect) throw new Error(`Prospect ${args.prospectId} not found`);
    await ctx.db.patch(args.prospectId, {
      buildSteps: {
        ...prospect.buildSteps,
        dnsCreated: false,
        imagesSourced: false,
        designApplied: false,
      },
      lukeOutput: undefined,
      lukeFailedReason: undefined,
      dnsWarn: false,
    });
    return { reset: true };
  },
});

export const triggerLuke = mutation({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    const prospect = await ctx.db.get(args.prospectId);
    if (!prospect) throw new Error(`Prospect ${args.prospectId} not found`);
    if (prospect.status !== "site_built") {
      throw new Error(
        `Luke requires status=site_built, got: ${prospect.status}`,
      );
    }
    await ctx.scheduler.runAfter(0, internal.agents.luke.run, args);
    return { scheduled: true, prospectId: args.prospectId };
  },
});

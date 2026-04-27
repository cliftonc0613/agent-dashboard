import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

export const get = internalQuery({
  args: { id: v.id("prospects") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const insert = internalMutation({
  args: {
    businessName: v.string(),
    websiteDomain: v.string(),
    linkedinProfileUrl: v.optional(v.string()),
    market: v.string(),
    industry: v.string(),
    specificHooks: v.array(v.string()),
    status: v.union(
      v.literal("prospected"),
      v.literal("brief_ready"),
      v.literal("site_built"),
      v.literal("approved"),
      v.literal("queued_for_send"),
      v.literal("sent"),
      v.literal("rejected"),
      v.literal("failed"),
      v.literal("needs_manual_review"),
    ),
    runId: v.id("runs"),
    retryCount: v.number(),
    buildSteps: v.object({
      repoCreated: v.boolean(),
      siteJsonPushed: v.boolean(),
      projectCreated: v.boolean(),
      domainAdded: v.boolean(),
      deployed: v.boolean(),
      certReady: v.boolean(),
      verified: v.boolean(),
      dnsCreated: v.boolean(),
      imagesSourced: v.boolean(),
      designApplied: v.boolean(),
    }),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("prospects", args);
  },
});

export const patch = internalMutation({
  args: {
    id: v.id("prospects"),
    status: v.optional(
      v.union(
        v.literal("prospected"),
        v.literal("brief_ready"),
        v.literal("site_built"),
        v.literal("approved"),
        v.literal("queued_for_send"),
        v.literal("sent"),
        v.literal("rejected"),
        v.literal("failed"),
        v.literal("needs_manual_review"),
      ),
    ),
    leiaOutput: v.optional(v.any()),
    ahsokaReview: v.optional(v.any()),
    hanDraft: v.optional(v.string()),
    humanScore: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    siteUrl: v.optional(v.string()),
    templateVersion: v.optional(v.string()),
    repoName: v.optional(v.string()),
    customSubdomain: v.optional(v.string()),
    cfProjectName: v.optional(v.string()),
    pagesDevUrl: v.optional(v.string()),
    chewieNotes: v.optional(v.string()),
    lukeOutput: v.optional(v.any()),
    dnsWarn: v.optional(v.boolean()),
    lukeFailedReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    const cleanPatch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) cleanPatch[k] = val;
    }
    await ctx.db.patch(id, cleanPatch);
  },
});

export const markBuildStep = internalMutation({
  args: {
    id: v.id("prospects"),
    step: v.union(
      v.literal("repoCreated"),
      v.literal("siteJsonPushed"),
      v.literal("projectCreated"),
      v.literal("domainAdded"),
      v.literal("deployed"),
      v.literal("certReady"),
      v.literal("verified"),
      v.literal("dnsCreated"),
      v.literal("imagesSourced"),
      v.literal("designApplied"),
    ),
    extra: v.optional(
      v.object({
        repoName: v.optional(v.string()),
        customSubdomain: v.optional(v.string()),
        cfProjectName: v.optional(v.string()),
        pagesDevUrl: v.optional(v.string()),
        siteUrl: v.optional(v.string()),
        templateVersion: v.optional(v.string()),
        chewieNotes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { id, step, extra }) => {
    const prospect = await ctx.db.get(id);
    if (!prospect) {
      throw new Error(`Prospect ${id} not found`);
    }
    const newSteps = { ...prospect.buildSteps, [step]: true };
    const patch: Record<string, unknown> = { buildSteps: newSteps };
    if (extra) {
      for (const [k, val] of Object.entries(extra)) {
        if (val !== undefined) patch[k] = val;
      }
    }
    await ctx.db.patch(id, patch);
  },
});

export const getById = query({
  args: { id: v.id("prospects") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const listLast90Days = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NINETY_DAYS_MS;
    return await ctx.db
      .query("prospectedBusinesses")
      .filter((q) => q.gte(q.field("prospectedAt"), cutoff))
      .collect();
  },
});

export const insert = internalMutation({
  args: {
    businessNameNormalized: v.string(),
    websiteDomain: v.string(),
    linkedinProfileUrl: v.optional(v.string()),
    prospectedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("prospectedBusinesses", args);
  },
});

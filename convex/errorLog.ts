import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const insert = internalMutation({
  args: {
    prospectId: v.optional(v.id("prospects")),
    runId: v.optional(v.id("runs")),
    agentName: v.optional(v.string()),
    message: v.string(),
    stack: v.optional(v.string()),
    severity: v.union(
      v.literal("warning"),
      v.literal("error"),
      v.literal("critical"),
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("errorLog", args);
  },
});

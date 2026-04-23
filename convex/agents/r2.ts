"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const run = internalAction({
  args: {
    market: v.string(),
    niche: v.string(),
    targetCount: v.number(),
    runId: v.optional(v.id("runs")),
  },
  handler: async () => {
    throw new Error("R2 not yet implemented — see 04-03-PLAN.md");
  },
});

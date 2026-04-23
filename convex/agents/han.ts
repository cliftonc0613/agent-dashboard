"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async () => {
    throw new Error("Han not yet implemented — see 04-06-PLAN.md");
  },
});

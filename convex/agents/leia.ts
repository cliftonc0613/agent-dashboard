"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async () => {
    throw new Error("Leia not yet implemented — see 04-04-PLAN.md");
  },
});

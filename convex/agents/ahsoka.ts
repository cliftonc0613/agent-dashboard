"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    siteUrl: v.string(),
    runId: v.optional(v.id("runs")),
  },
  handler: async () => {
    throw new Error("Ahsoka not yet implemented — see 04-05-PLAN.md");
  },
});

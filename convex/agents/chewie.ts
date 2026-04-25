"use node";

/**
 * chewie.ts — STUB. Plan 5-01 creates this stub solely so triggerChewie
 * type-checks. Plan 5-02 replaces the entire file with the real agent.
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async () => {
    throw new Error("Chewie stub — real implementation lands in Plan 5-02");
  },
});

import { internalMutation } from "./_generated/server";

/**
 * initPipelineControl — idempotent seed for the pipelineControl singleton.
 *
 * The pipelineControl table holds exactly one row: the runtime kill switch
 * and cost ceilings that gate every agent run. This mutation is safe to call
 * multiple times — on first call it inserts the locked-down defaults; on
 * every subsequent call it returns early without touching the existing row.
 *
 * Defaults are intentionally conservative:
 *   - paused: true             → pipeline starts halted; human flips when ready
 *   - dryRun: true             → no external side effects until shadow period ends
 *   - dailyCostCeilingUsd:      $10/day cap across all Claude calls
 *   - perRunCostCeilingUsd:     $5/run cap (half the daily ceiling)
 *   - dailySendCap:             10 outreach sends/day when live
 *   - inputTokenCostPer1M:      $3/MTok  (Sonnet 4.6 list price, 2026-04)
 *   - outputTokenCostPer1M:     $15/MTok (Sonnet 4.6 list price, 2026-04)
 *
 * Invoked manually via `npx convex run seed:initPipelineControl` after the
 * schema deploy in plan 02-02. Never called from cron or agent code.
 *
 * SOFT-MIGRATION NOTE (03-01): If pipelineControl row exists without pricing
 * fields (pre-Phase-3 deploys seeded before plan 03-01 added them here), the
 * idempotency guard below intentionally preserves that row. Update manually via
 * Convex dashboard — `convex/lib/cost.ts::getPricing` falls back to $3/$15
 * defaults when the fields are absent, so this is a soft migration, not a
 * breaking one.
 */
export const initPipelineControl = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("pipelineControl").first();
    if (existing) return;
    await ctx.db.insert("pipelineControl", {
      paused: true,
      dryRun: true,
      dailyCostCeilingUsd: 10,
      perRunCostCeilingUsd: 5,
      dailySendCap: 10,
      inputTokenCostPer1M: 3,
      outputTokenCostPer1M: 15,
    });
  },
});

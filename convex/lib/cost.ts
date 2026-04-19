import { internalQuery } from "../_generated/server";

/**
 * cost.ts — pricing lookup + pure-math helper for the callAgent wrapper.
 *
 * Default Convex runtime (no "use node" directive) so wave-2 Node-runtime
 * actions can cheaply `ctx.runQuery(internal.lib.cost.getPricing, {})` before
 * each Claude call.
 *
 * Folder naming: `lib/` (not `_shared/`) — matches the Next.js-adjacent
 * convention already in use at `agent-dashboard/lib/`, and avoids the
 * `_generated/`-style leading-underscore confusion.
 */

/**
 * Fallback defaults matching Sonnet 4.6 list price (2026-04). Production
 * reads from pipelineControl.inputTokenCostPer1M / outputTokenCostPer1M — edit
 * those in the Convex dashboard to change pricing without redeploying.
 */
const DEFAULT_INPUT_PRICE_PER_MTOK = 3.0;
const DEFAULT_OUTPUT_PRICE_PER_MTOK = 15.0;

/**
 * getPricing — returns the current per-MTok prices for Claude input/output
 * tokens, read from the pipelineControl singleton. Falls back to 2026-04
 * Sonnet 4.6 list prices ($3/$15 per MTok) when fields are absent (soft
 * migration path for pre-Phase-3 seeded rows).
 */
export const getPricing = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("pipelineControl").first();
    return {
      inputPricePerMTok: row?.inputTokenCostPer1M ?? DEFAULT_INPUT_PRICE_PER_MTOK,
      outputPricePerMTok:
        row?.outputTokenCostPer1M ?? DEFAULT_OUTPUT_PRICE_PER_MTOK,
    };
  },
});

/**
 * calculateCost — pure function (NOT a Convex query/mutation). Imported
 * directly by the callAgent wrapper after it has the per-MTok prices from
 * getPricing and the token counts from the Anthropic SDK response.
 *
 * Returns USD cost rounded to 6 decimals (sub-millionth-of-a-dollar precision
 * — enough headroom for fractional-cent ceiling arithmetic without drifting
 * on repeated float additions across a run).
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMTok: number,
  outputPricePerMTok: number,
): number {
  const input = (inputTokens / 1_000_000) * inputPricePerMTok;
  const output = (outputTokens / 1_000_000) * outputPricePerMTok;
  return Number((input + output).toFixed(6));
}

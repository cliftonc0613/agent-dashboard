import { internalMutation } from "../_generated/server";

/**
 * One-shot backfill: sets pagesPolished = false on every existing prospect row.
 * Run via: npx convex run migrations/lukePagesBackfill:backfillPagesStep
 * Idempotent: skips rows that already have the key.
 */
export const backfillPagesStep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("prospects").collect();
    let patched = 0;
    let skipped = 0;
    for (const p of all) {
      const bs = p.buildSteps as Record<string, boolean> | undefined;
      if (!bs) { skipped++; continue; }
      if (bs.pagesPolished !== undefined) { skipped++; continue; }
      await ctx.db.patch(p._id, {
        buildSteps: { ...bs, pagesPolished: false } as any,
      });
      patched++;
    }
    console.log(`[luke pages backfill] patched=${patched} skipped=${skipped}`);
    return { patched, skipped };
  },
});

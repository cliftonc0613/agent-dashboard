import { internalMutation } from "../_generated/server";

/**
 * One-shot backfill: sets dnsCreated, imagesSourced, designApplied = false
 * on every existing prospect row before schema tightens from optional to required.
 * Run via: npx convex run migrations/lukeBuildStepsBackfill:backfillLukeBuildSteps
 * Idempotent: skips rows that already have the keys.
 */
export const backfillLukeBuildSteps = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("prospects").collect();
    let patched = 0;
    let skipped = 0;
    for (const p of all) {
      const bs = p.buildSteps as Record<string, boolean> | undefined;
      if (!bs) { skipped++; continue; }
      const needs =
        bs.dnsCreated === undefined ||
        bs.imagesSourced === undefined ||
        bs.designApplied === undefined;
      if (!needs) { skipped++; continue; }
      await ctx.db.patch(p._id, {
        buildSteps: {
          ...bs,
          dnsCreated: bs.dnsCreated ?? false,
          imagesSourced: bs.imagesSourced ?? false,
          designApplied: bs.designApplied ?? false,
        } as any,
      });
      patched++;
    }
    console.log(`[luke backfill] patched=${patched} skipped=${skipped}`);
    return { patched, skipped };
  },
});

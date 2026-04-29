import { internalMutation } from "../_generated/server";

/**
 * One-shot reset: sets imagesSourced = false on every prospect that has it
 * set to true, so Luke re-runs Step 2 with the fixed upsertField regex and
 * the real Unsplash key.
 * Run via: npx convex run migrations/resetImagesSourced:resetImagesSourced
 */
export const resetImagesSourced = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("prospects").collect();
    let patched = 0;
    let skipped = 0;
    for (const p of all) {
      const bs = p.buildSteps as Record<string, boolean> | undefined;
      if (!bs || !bs.imagesSourced) { skipped++; continue; }
      await ctx.db.patch(p._id, {
        buildSteps: { ...bs, imagesSourced: false } as any,
      });
      patched++;
    }
    console.log(`[resetImagesSourced] patched=${patched} skipped=${skipped}`);
    return { patched, skipped };
  },
});

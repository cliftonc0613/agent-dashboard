import { internalMutation } from "../_generated/server";

export const debugBuildSteps = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("prospects").collect();
    for (const p of all) {
      console.log(JSON.stringify({
        id: p._id,
        name: p.businessName,
        buildSteps: p.buildSteps,
      }));
    }
    return { count: all.length };
  },
});

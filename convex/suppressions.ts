import { internalQuery } from "./_generated/server";

export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("suppressions").collect();
  },
});

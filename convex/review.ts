import { query } from "./_generated/server";
import { requireReviewer } from "./lib/reviewAuth";

export const queue = query({
  args: {},
  handler: async (ctx) => {
    await requireReviewer(ctx);
    return [];
  },
});

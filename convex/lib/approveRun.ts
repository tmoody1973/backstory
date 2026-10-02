import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isLowConfidence } from "./geocode";

// A run holds at most 40 mentions, 3 topics and 10 actions (extraction schema).
const MAX_ROWS_PER_RUN = 200;

/**
 * Approve every still-pending row of a run (decision 010). Rows an editor rejected stay rejected.
 * A place with no confident pin stays pending unless an editor approved it by hand: the pin could be
 * the wrong branch or someone's street.
 */
export async function approveRun(ctx: MutationCtx, storyId: Id<"stories">, runId: string): Promise<void> {
  const mentions = await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  for (const row of mentions) if (row.reviewStatus === "pending") await ctx.db.patch("mentions", row._id, { reviewStatus: "approved" });
  const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  for (const row of places) {
    const confident = row.geocodeConfidence !== undefined && !isLowConfidence(row.geocodeConfidence);
    if (row.reviewStatus === "pending" && confident) await ctx.db.patch("places", row._id, { reviewStatus: "approved" });
  }
  const topics = await ctx.db.query("storyTopics").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  for (const row of topics) if (row.reviewStatus === "pending") await ctx.db.patch("storyTopics", row._id, { reviewStatus: "approved" });
  const actions = await ctx.db.query("storyActions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  for (const row of actions) if (row.reviewStatus === "pending") await ctx.db.patch("storyActions", row._id, { reviewStatus: "approved" });
}

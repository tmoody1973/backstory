import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// A run holds at most 40 mentions, 3 topics and 10 actions (extraction schema).
const MAX_ROWS_PER_RUN = 200;

/**
 * PRD fallback for the demo: approve every pending row in a story's latest run at once.
 * Internal only, so it runs from the CLI or dashboard and never from a browser:
 *   npx convex run admin:approveLatestRunForDemo '{"storyId":"..."}'
 * Plan 2 (MOO-853) replaces this with Clerk-checked, per-item review mutations.
 */
export const approveLatestRunForDemo = internalMutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    if (!story?.latestRunId || !story.proposedSummary) throw new Error("Story has no extraction run to approve yet");
    const runId = story.latestRunId;

    const mentions = await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    for (const row of mentions) if (row.reviewStatus === "pending") await ctx.db.patch("mentions", row._id, { reviewStatus: "approved" });
    const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    for (const row of places) if (row.reviewStatus === "pending") await ctx.db.patch("places", row._id, { reviewStatus: "approved" });
    const topics = await ctx.db.query("storyTopics").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    for (const row of topics) if (row.reviewStatus === "pending") await ctx.db.patch("storyTopics", row._id, { reviewStatus: "approved" });
    const actions = await ctx.db.query("storyActions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    for (const row of actions) if (row.reviewStatus === "pending") await ctx.db.patch("storyActions", row._id, { reviewStatus: "approved" });

    await ctx.db.patch("stories", storyId, { summary: story.proposedSummary, approvedRunId: runId, reviewStatus: "approved" });
  },
});

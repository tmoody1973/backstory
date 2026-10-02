import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { enqueue } from "./jobs";
import { isLowConfidence } from "./lib/geocode";

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
    // A place with no confident pin waits for an editor; a pin could be the wrong branch or someone's street.
    for (const row of places) {
      const confident = row.geocodeConfidence !== undefined && !isLowConfidence(row.geocodeConfidence);
      if (row.reviewStatus === "pending" && confident) await ctx.db.patch("places", row._id, { reviewStatus: "approved" });
    }
    const topics = await ctx.db.query("storyTopics").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    for (const row of topics) if (row.reviewStatus === "pending") await ctx.db.patch("storyTopics", row._id, { reviewStatus: "approved" });
    const actions = await ctx.db.query("storyActions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    for (const row of actions) if (row.reviewStatus === "pending") await ctx.db.patch("storyActions", row._id, { reviewStatus: "approved" });

    await ctx.db.patch("stories", storyId, { summary: story.proposedSummary, approvedRunId: runId, reviewStatus: "approved" });
  },
});

/**
 * Re-run extraction on an existing transcript (no new Transcribe bill), e.g. after a prompt change:
 *   npx convex run admin:reextract '{"storyId":"..."}'
 * The new run is pending; whatever an editor already approved stays live until they approve the new one.
 */
export const reextract = internalMutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const segment = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId))
      .first();
    if (!segment) throw new Error(`Story ${storyId} has no transcript yet`);
    await enqueue(ctx, "extract", storyId, internal.aws.extract.run);
  },
});

/**
 * Transcribe a story again from its audio, e.g. after the custom vocabulary changes (bills Transcribe again):
 *   npx convex run admin:retranscribe '{"storyId":"..."}'
 * The new job has no Transcribe job name yet, so it starts a fresh job instead of resuming the old one.
 * Extraction and geocoding follow automatically; approved runs stay live until an editor approves the new one.
 */
export const retranscribe = internalMutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    if (!(await ctx.db.get("stories", storyId))) throw new Error(`Story ${storyId} not found`);
    await enqueue(ctx, "transcribe", storyId, internal.aws.transcribe.start);
  },
});

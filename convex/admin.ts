import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { enqueue, transcribeStep } from "./jobs";
import { approveRun } from "./lib/approveRun";
import { refreshStorySearch } from "./lib/storySearch";

/**
 * PRD fallback for the demo: approve every pending row in a story's latest run at once.
 * Internal only, so it runs from the CLI or dashboard and never from a browser:
 *   npx convex run admin:approveLatestRunForDemo '{"storyId":"..."}'
 * The spec's last-resort fallback; editors approve through reviewMutations.approveEpisode (MOO-853).
 */
export const approveLatestRunForDemo = internalMutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    if (!story?.latestRunId || !story.proposedSummary) throw new Error("Story has no extraction run to approve yet");
    await approveRun(ctx, storyId, story.latestRunId);
    await ctx.db.patch("stories", storyId, { summary: story.proposedSummary, approvedRunId: story.latestRunId, reviewStatus: "approved" });
    await refreshStorySearch(ctx, storyId);
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
    await enqueue(ctx, "transcribe", storyId, transcribeStep());
  },
});

/** Backfill or repair: recompute every story's search text (≤ 1000 stories). */
export const refreshAllStorySearch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stories = await ctx.db.query("stories").take(1000);
    for (const story of stories) await refreshStorySearch(ctx, story._id);
    return { refreshed: stories.length };
  },
});

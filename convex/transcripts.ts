import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { enqueue, markDone } from "./jobs";

// Same ceiling as extractions.loadInput: far above a 30-minute episode's ~600 segments.
const MAX_SEGMENTS = 5000;

export const audioFor = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    if (!story) throw new Error(`Story ${storyId} not found`);
    return { audioUrl: story.audioUrl };
  },
});

export const jobExternalId = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job?.externalId) throw new Error(`Job ${jobId} has no Transcribe job name`);
    return { externalId: job.externalId };
  },
});

export const markTranscribing = internalMutation({
  args: { jobId: v.id("jobs"), storyId: v.id("stories"), externalId: v.string() },
  handler: async (ctx, { jobId, storyId, externalId }) => {
    await ctx.db.patch("jobs", jobId, { externalId, updatedAt: Date.now() });
    await ctx.db.patch("stories", storyId, { stage: "transcribing" });
  },
});

export const save = internalMutation({
  args: {
    jobId: v.id("jobs"),
    storyId: v.id("stories"),
    ref: v.string(),
    segments: v.array(v.object({ speaker: v.string(), startMs: v.number(), endMs: v.number(), text: v.string() })),
  },
  handler: async (ctx, { jobId, storyId, ref, segments }) => {
    const existing = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId))
      .take(MAX_SEGMENTS);
    for (const row of existing) await ctx.db.delete("transcriptSegments", row._id);
    for (const [idx, segment] of segments.entries()) {
      await ctx.db.insert("transcriptSegments", { storyId, idx, ...segment });
    }
    await ctx.db.insert("sources", { storyId, kind: "transcript", ref, fetchedAt: Date.now() });
    await ctx.db.patch("stories", storyId, { stage: "transcribed" });
    await markDone(ctx, jobId);
    await enqueue(ctx, "extract", storyId, internal.aws.extract.run);
  },
});

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { attribution } from "./lib/attribution";
import { mentionAttention, placeAttention } from "./lib/attention";
import { requireReviewer } from "./lib/reviewAuth";
import { getShowProfile } from "./lib/shows";

// ponytail: newest 100 per status; a cursor-paged queue when the backfill makes the backlog longer than that.
const QUEUE_LIMIT = 100;
// A run holds at most 40 mentions, 3 topics and 10 actions (extraction schema).
const MAX_ROWS_PER_RUN = 200;
// Deepgram utterances for a 56-minute episode stay well under this.
const MAX_SEGMENTS = 4000;

type NeedsReview = "new" | "reprocessed" | "pipeline_failed";

function needsReview(story: Doc<"stories">): NeedsReview | null {
  if (story.stage === "needs_editor") return "pipeline_failed";
  if (story.stage !== "geocoded" || !story.latestRunId) return null;
  if (story.reviewStatus === "pending") return "new";
  return story.reviewStatus === "approved" && story.latestRunId !== story.approvedRunId ? "reprocessed" : null;
}

export const queue = query({
  args: { showSlug: v.optional(v.string()) },
  handler: async (ctx, { showSlug }) => {
    await requireReviewer(ctx);
    const byStatus = (status: "pending" | "approved") =>
      ctx.db.query("stories").withIndex("by_reviewStatus_and_publishedAt", (q) => q.eq("reviewStatus", status)).order("desc").take(QUEUE_LIMIT);
    const stories = [...(await byStatus("pending")), ...(await byStatus("approved"))]
      .filter((story) => !showSlug || story.showSlug === showSlug)
      .sort((a, b) => b.publishedAt - a.publishedAt);
    const rows = [];
    for (const story of stories) {
      const reason = needsReview(story);
      if (!reason) continue;
      const profile = getShowProfile(story.showSlug);
      // ponytail: reads each listed story's latest run (≤200 rows); keep counts on the story if the queue grows past ~50
      const counts = story.latestRunId ? countItems(await itemsFor(ctx, story._id, story.latestRunId)) : { items: 0, needsYou: 0 };
      rows.push({
        storyId: story._id, title: story.title, showSlug: story.showSlug, showName: profile.name, reviewer: profile.reviewer,
        contentType: story.contentType, publishedAt: story.publishedAt, stage: story.stage,
        reviewStatus: story.reviewStatus, doNotUse: story.doNotUse, needsReview: reason, ...counts,
      });
    }
    return rows;
  },
});

export const episode = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    await requireReviewer(ctx);
    const story = await ctx.db.get("stories", storyId);
    const runId = story?.latestRunId;
    if (!story || !runId) return null;
    const profile = getShowProfile(story.showSlug);
    return {
      story: {
        storyId, title: story.title, showSlug: story.showSlug, showName: profile.name, reviewer: profile.reviewer,
        publishedAt: story.publishedAt, audioUrl: story.audioUrl, permalink: story.permalink ?? null, stage: story.stage,
        reviewStatus: story.reviewStatus, doNotUse: story.doNotUse, proposedSummary: story.proposedSummary ?? "",
        summary: story.summary ?? null, latestRunId: runId, approvedRunId: story.approvedRunId ?? null,
        approvedBy: story.approvedBy ?? null, approvedAt: story.approvedAt ?? null,
        attribution: attribution(profile.name, story.publishedAt),
      },
      speakers: await speakersFor(ctx, storyId),
      ...(await itemsFor(ctx, storyId, runId)),
    };
  },
});

/** The run's people, places, topics and actions, each with its evidence quote; places with the weakest map pins first. */
async function itemsFor(ctx: QueryCtx, storyId: Id<"stories">, runId: string) {
  const mentions = await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  const topics = await ctx.db.query("storyTopics").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  const actions = await ctx.db.query("storyActions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  const mentionById = new Map(mentions.map((m) => [m._id, m]));
  return {
    mentions: mentions.filter((m) => m.entityType !== "place").map((m) => ({
      id: m._id, entityType: m.entityType, name: m.name, quote: m.quote, startMs: m.startMs,
      subjectConfidence: m.subjectConfidence ?? null, reviewStatus: m.reviewStatus, removeReason: m.removeReason ?? null,
      doNotUse: m.doNotUse, attention: mentionAttention(m),
    })),
    places: places
      .map((p) => ({
        id: p._id, mentionId: p.mentionId, name: p.name, officialName: p.officialName ?? null, category: p.category,
        geocodeLabel: p.geocodeLabel ?? null, geocodeConfidence: p.geocodeConfidence ?? null, neighborhood: p.neighborhood ?? null,
        quote: mentionById.get(p.mentionId)?.quote ?? "", startMs: mentionById.get(p.mentionId)?.startMs ?? 0, reviewStatus: p.reviewStatus,
        removeReason: p.removeReason ?? null, attention: placeAttention(p),
      }))
      .sort((a, b) => (a.geocodeConfidence ?? -1) - (b.geocodeConfidence ?? -1)), // no pin at all, then weakest pins, first
    topics: topics.map((t) => ({
      id: t._id, topic: t.topic, confidence: t.confidence, quote: t.quote, startMs: t.startMs, reviewStatus: t.reviewStatus,
      removeReason: t.removeReason ?? null, attention: null,
    })),
    actions: actions.map((a) => ({
      id: a._id, kind: a.kind, label: a.label, quote: a.quote, startMs: a.startMs, reviewStatus: a.reviewStatus,
      removeReason: a.removeReason ?? null, attention: null,
      place: a.placeMentionId ? (mentionById.get(a.placeMentionId)?.name ?? null) : null,
    })),
  };
}

/** One row per transcript speaker label, in order of first appearance, with their first line (and its times, for an audio clip) so an editor can tell who it is. */
async function speakersFor(ctx: QueryCtx, storyId: Id<"stories">) {
  const segments = await ctx.db.query("transcriptSegments").withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId)).take(MAX_SEGMENTS);
  const names = await ctx.db.query("speakerNames").withIndex("by_storyId", (q) => q.eq("storyId", storyId)).take(50);
  const firstLine = new Map<string, Doc<"transcriptSegments">>();
  for (const segment of segments) if (!firstLine.has(segment.speaker)) firstLine.set(segment.speaker, segment);
  return [...firstLine].map(([label, first]) => {
    const named = names.find((row) => row.label === label);
    return { label, name: named?.name ?? null, source: named?.source ?? null, sample: first.text, startMs: first.startMs, endMs: first.endMs };
  });
}

type Items = Awaited<ReturnType<typeof itemsFor>>;

/** Every reviewable item, and how many still need a reviewer (undecided and flagged). */
function countItems({ mentions, places, topics, actions }: Items) {
  const all = [...mentions, ...places, ...topics, ...actions];
  return { items: all.length, needsYou: all.filter((item) => item.reviewStatus === "pending" && item.attention).length };
}

import { allowsDetailedAnswers } from "./lib/askStory";
import { placeKey } from "./lib/placeDirectory";
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
        contentType: story.contentType, publishedAt: story.publishedAt, audioUrl: story.audioUrl, permalink: story.permalink ?? null, stage: story.stage,
        reviewStatus: story.reviewStatus, doNotUse: story.doNotUse, proposedSummary: story.proposedSummary ?? "",
        allowDetailedAnswers: allowsDetailedAnswers(story, profile), detailedAnswersDefault: profile.detailedAnswersDefault,
        summary: story.summary ?? null, latestRunId: runId, approvedRunId: story.approvedRunId ?? null,
        approvedBy: story.approvedBy ?? null, approvedAt: story.approvedAt ?? null,
        attribution: attribution(profile.name, story.publishedAt),
      },
      speakers: await speakersFor(ctx, storyId),
      song: await songFor(ctx, storyId, runId),
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
        geocodeLabel: p.geocodeLabel ?? null, geocodeConfidence: p.geocodeConfidence ?? null, neighborhood: p.neighborhood ?? null, reservationUrl: p.reservationUrl ?? null,
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

/** Places & Organizations: one row per published place (by name) across episodes, flagged for what an editor should fill in. */
export const places = query({
  args: {},
  handler: async (ctx) => {
    await requireReviewer(ctx);
    const groups = new Map<string, {
      key: string; name: string; kind: "place" | "organization"; category: string; stories: { storyId: string; title: string; showName: string }[];
      hasPin: boolean; lowConfidence: boolean; neighborhood: string | null; reservationUrl: string | null; address: string | null;
      phone: string | null; website: string | null; openingHours: string | null; mentionId: string | null;
    }>();
    const add = (key: string, story: Doc<"stories">, init: () => Parameters<typeof groups.set>[1]) => {
      const group = groups.get(key) ?? init();
      if (!group.stories.some((s) => s.storyId === story._id)) group.stories.push({ storyId: story._id, title: story.title, showName: getShowProfile(story.showSlug).name });
      groups.set(key, group);
      return group;
    };
    for (const story of await ctx.db.query("stories").take(500)) {
      const runId = story.approvedRunId;
      if (!runId || story.reviewStatus !== "approved" || story.doNotUse) continue;
      const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", story._id).eq("runId", runId)).take(200);
      const mentions = await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", story._id).eq("runId", runId)).take(200);
      const placeMentions = new Set(places.map((p) => p.mentionId));
      for (const p of places.filter((p) => p.reviewStatus === "approved")) {
        const g = add(placeKey(p), story, () => ({
          key: placeKey(p), name: p.officialName ?? p.name, kind: "place", category: p.category, stories: [], hasPin: false, lowConfidence: false,
          neighborhood: null, reservationUrl: null, address: null, phone: null, website: null, openingHours: null, mentionId: p.mentionId,
        }));
        g.hasPin ||= p.lat !== undefined;
        g.lowConfidence ||= p.geocodeConfidence !== undefined && p.geocodeConfidence < 0.8;
        g.neighborhood ??= p.neighborhood ?? null;
        g.reservationUrl ??= p.reservationUrl ?? null;
        g.address ??= p.geocodeLabel ?? null;
        g.phone ??= p.phone ?? null;
        g.website ??= p.website ?? null;
        g.openingHours ??= p.openingHours ?? null;
      }
      // Organizations the story names but hasn't placed on a map: listed so an editor can Add location.
      for (const m of mentions.filter((m) => m.entityType === "organization" && m.reviewStatus === "approved" && !m.doNotUse && !placeMentions.has(m._id))) {
        add(placeKey(m), story, () => ({
          key: placeKey(m), name: m.name, kind: "organization", category: "organization", stories: [], hasPin: false, lowConfidence: false,
          neighborhood: null, reservationUrl: null, address: null, phone: null, website: null, openingHours: null, mentionId: m._id,
        }));
      }
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
});

const PUBLISHED_LIMIT = 300;

/** Published episodes, newest first: a way back to any episode's review page after it leaves the queue. */
export const published = query({
  args: { showSlug: v.optional(v.string()) },
  handler: async (ctx, { showSlug }) => {
    await requireReviewer(ctx);
    const stories = await ctx.db
      .query("stories")
      .withIndex("by_reviewStatus_and_publishedAt", (q) => q.eq("reviewStatus", "approved"))
      .order("desc")
      .take(PUBLISHED_LIMIT);
    return stories
      .filter((story) => story.approvedRunId && (!showSlug || story.showSlug === showSlug))
      .map((story) => ({
        storyId: story._id, title: story.title, showSlug: story.showSlug, showName: getShowProfile(story.showSlug).name,
        publishedAt: story.publishedAt, doNotUse: story.doNotUse,
        // Re-processed since publishing: the live version stays until an editor approves the new one.
        newVersionWaiting: story.latestRunId !== story.approvedRunId,
      }));
  },
});

/** The run's song record for the review page (premieres and sessions), or null. */
async function songFor(ctx: QueryCtx, storyId: Id<"stories">, runId: string) {
  const song = await ctx.db.query("songs").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).first();
  if (!song) return null;
  const { _id, _creationTime, storyId: _s, runId: _r, ...fields } = song;
  return { songId: _id, ...fields, removeReason: fields.removeReason ?? null };
}

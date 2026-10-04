import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { enqueue, markDone } from "./jobs";
import { normalizeForMatch } from "./lib/evidence";
import { editorPlaceDetails, placeKey } from "./lib/placeDirectory";
import { actionKindValidator, entityTypeValidator, placeCategoryValidator, topicValidator } from "./schema";

// A 30-minute episode is ~600 Transcribe segments; this ceiling covers multi-hour audio.
const MAX_SEGMENTS = 5000;

export const loadInput = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    if (!story) throw new Error(`Story ${storyId} not found`);
    const segments = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId))
      .take(MAX_SEGMENTS);
    return {
      showSlug: story.showSlug,
      title: story.title,
      teaserText: story.teaserText,
      publishedAt: story.publishedAt,
      segments: segments.map(({ speaker, startMs, endMs, text }) => ({ speaker, startMs, endMs, text })),
    };
  },
});

const evidence = { quote: v.string(), startMs: v.number(), speaker: v.string() };
const songValidator = v.object({
  artist: v.string(),
  title: v.optional(v.string()),
  album: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  credits: v.array(v.object({ role: v.string(), name: v.string() })),
  releaseShow: v.optional(v.object({ venue: v.string(), date: v.string() })),
  setList: v.optional(v.array(v.string())),
});

export const save = internalMutation({
  args: {
    jobId: v.id("jobs"),
    storyId: v.id("stories"),
    runId: v.string(),
    result: v.object({
      summary: v.string(),
      mentions: v.array(
        v.object({
          entityType: entityTypeValidator,
          name: v.string(),
          placeCategory: v.union(placeCategoryValidator, v.null()),
          relatedPlace: v.union(v.string(), v.null()),
          subjectConfidence: v.optional(v.number()),
          ...evidence,
        }),
      ),
      topics: v.array(v.object({ topic: topicValidator, confidence: v.number(), ...evidence })),
      actions: v.array(
        v.object({ kind: actionKindValidator, label: v.string(), placeName: v.union(v.string(), v.null()), ...evidence }),
      ),
      song: v.optional(v.union(v.null(), songValidator)),
    }),
  },
  handler: async (ctx, { jobId, storyId, runId, result }) => {
    const placeMentions = new Map<string, Id<"mentions">>();
    const keepOff = await keptOffAlexa(ctx, storyId);
    // Neighborhood, reservation link, details and a hand-set pin follow the place onto the new run.
    const carried = await editorPlaceDetails(ctx);
    for (const mention of result.mentions) {
      // An editor said "true, but keep off Alexa" on an earlier run: the new run starts with the same decision.
      const decision = keepOff.has(normalizeForMatch(mention.name))
        ? { reviewStatus: "rejected" as const, removeReason: "sensitive" as const }
        : { reviewStatus: "pending" as const };
      const mentionId = await ctx.db.insert("mentions", {
        storyId,
        runId,
        entityType: mention.entityType,
        name: mention.name,
        quote: mention.quote,
        startMs: mention.startMs,
        speaker: mention.speaker,
        relatedPlace: mention.relatedPlace ?? undefined,
        subjectConfidence: mention.subjectConfidence,
        ...decision,
        doNotUse: false,
        searchText: normalizeForMatch(`${mention.name} ${mention.relatedPlace ?? ""} ${mention.quote}`),
      });
      if (mention.entityType === "place" && mention.placeCategory) {
        placeMentions.set(normalizeForMatch(mention.name), mentionId);
        await ctx.db.insert("places", {
          storyId, runId, mentionId, name: mention.name, category: mention.placeCategory, ...decision,
          ...(carried.get(placeKey({ name: mention.name })) ?? {}),
        });
      }
    }
    for (const { speaker: _speaker, ...topic } of result.topics) {
      await ctx.db.insert("storyTopics", { storyId, runId, ...topic, basis: "transcript", reviewStatus: "pending" });
    }
    for (const action of result.actions) {
      await ctx.db.insert("storyActions", {
        storyId,
        runId,
        kind: action.kind,
        label: action.label,
        placeMentionId: action.placeName ? placeMentions.get(normalizeForMatch(action.placeName)) : undefined,
        quote: action.quote,
        startMs: action.startMs,
        reviewStatus: "pending",
      });
    }
    const story = await ctx.db.get("stories", storyId);
    if (result.song && story && story.contentType !== "episode") {
      const kind = story.contentType;
      await ctx.db.insert("songs", {
        storyId, runId, kind, ...result.song, reviewStatus: "pending",
        ...(kind === "premiere" && story.audioUrl ? { audioUrl: story.audioUrl } : {}),
      });
    }
    await ctx.db.patch("stories", storyId, { proposedSummary: result.summary, latestRunId: runId, stage: "extracted" });
    await markDone(ctx, jobId);
    await enqueue(ctx, "geocode", storyId, internal.aws.geocode.run);
  },
});

// A run holds at most 40 mentions (extraction schema).
const MAX_MENTIONS_PER_RUN = 200;

/** Normalized names an editor removed as "true, but keep off Alexa" in the story's previous or published run. */
async function keptOffAlexa(ctx: MutationCtx, storyId: Id<"stories">): Promise<Set<string>> {
  const story = await ctx.db.get("stories", storyId);
  const runs = [...new Set([story?.latestRunId, story?.approvedRunId].filter((run): run is string => Boolean(run)))];
  const names = new Set<string>();
  for (const runId of runs) {
    const mentions = await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_MENTIONS_PER_RUN);
    const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_MENTIONS_PER_RUN);
    for (const row of [...mentions, ...places]) if (row.removeReason === "sensitive") names.add(normalizeForMatch(row.name));
  }
  return names;
}

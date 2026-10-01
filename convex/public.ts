import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { attribution } from "./lib/attribution";
import { normalizeForMatch } from "./lib/evidence";
import { getShowProfile } from "./lib/shows";

// The contract with the Alexa MCP server: only rows from the editor-approved run, and
// nothing an editor rejected or marked not-for-assistant-use. These are public queries
// on purpose; they can only ever return approved data.

// A run holds at most 40 mentions, 3 topics and 10 actions (extraction schema).
const MAX_ROWS_PER_RUN = 200;

const approved = <T extends { reviewStatus: string }>(rows: T[]) => rows.filter((row) => row.reviewStatus === "approved");

export const getStory = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    const runId = story?.approvedRunId;
    if (!story || !runId || story.reviewStatus !== "approved" || story.doNotUse || !story.summary) return null;

    const places = approved(
      await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN),
    );
    const approvedPlaceMentions = new Set(places.map((place) => place.mentionId));
    // A place mention is only live while its place row is approved, so a rejected place's name never leaks.
    const mentions = approved(
      await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN),
    ).filter((mention) => !mention.doNotUse && (mention.entityType !== "place" || approvedPlaceMentions.has(mention._id)));
    const liveMentions = new Map(mentions.map((mention) => [mention._id, mention]));
    const livePlaces = places.filter((place) => liveMentions.has(place.mentionId));
    const topics = approved(
      await ctx.db.query("storyTopics").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN),
    );
    const actions = approved(
      await ctx.db.query("storyActions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN),
    ).filter((action) => !action.placeMentionId || liveMentions.has(action.placeMentionId));

    const show = getShowProfile(story.showSlug).name;
    return {
      storyId,
      show,
      title: story.title,
      summary: story.summary,
      publishedAt: story.publishedAt,
      attribution: attribution(show, story.publishedAt),
      audioUrl: story.audioUrl,
      permalink: story.permalink ?? null,
      mentions: mentions
        .filter((mention) => mention.entityType !== "place")
        .map(({ entityType, name, quote, startMs, relatedPlace }) => ({
          entityType, name, quote, startMs, relatedPlace: relatedPlace ?? null,
        })),
      places: livePlaces.map((place) => ({
        name: place.name,
        category: place.category,
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        neighborhood: place.neighborhood ?? null,
        quote: liveMentions.get(place.mentionId)!.quote,
      })),
      topics: topics.map(({ topic, confidence, quote }) => ({ topic, confidence, quote })),
      actions: actions.map((action) => ({
        kind: action.kind,
        label: action.label,
        quote: action.quote,
        place: action.placeMentionId ? liveMentions.get(action.placeMentionId)!.name : null,
      })),
    };
  },
});

export const searchStories = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const search = normalizeForMatch(text);
    if (!search) return [];
    const hits = await ctx.db
      .query("mentions")
      .withSearchIndex("search_text", (q) => q.search("searchText", search).eq("reviewStatus", "approved"))
      .take(50);
    const results = new Map<Id<"stories">, { storyId: Id<"stories">; title: string; attribution: string; matched: string }>();
    for (const mention of hits) {
      if (mention.doNotUse || results.has(mention.storyId)) continue;
      const story = await ctx.db.get("stories", mention.storyId);
      if (!story || story.reviewStatus !== "approved" || story.doNotUse || story.approvedRunId !== mention.runId) continue;
      if (mention.entityType === "place") {
        const place = await ctx.db.query("places").withIndex("by_mentionId", (q) => q.eq("mentionId", mention._id)).unique();
        if (place?.reviewStatus !== "approved") continue;
      }
      results.set(mention.storyId, {
        storyId: mention.storyId,
        title: story.title,
        attribution: attribution(getShowProfile(story.showSlug).name, story.publishedAt),
        matched: mention.name,
      });
    }
    return [...results.values()].slice(0, 10);
  },
});

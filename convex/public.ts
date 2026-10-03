import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { attribution } from "./lib/attribution";
import { allowsDetailedAnswers, blockedNames, detailWords, mentionsBlocked, trimPassage } from "./lib/askStory";
import { normalizeForMatch } from "./lib/evidence";
import { getShowProfile } from "./lib/shows";
import { firstSentence, relevantEnough } from "./lib/storySearch";

// The contract with the Alexa MCP server: only rows from the editor-approved run, and
// nothing an editor rejected or marked not-for-assistant-use. These are public queries
// on purpose; they can only ever return approved data.

// A run holds at most 40 mentions, 3 topics and 10 actions (extraction schema).
const MAX_ROWS_PER_RUN = 200;

const approved = <T extends { reviewStatus: string }>(rows: T[]) => rows.filter((row) => row.reviewStatus === "approved");

export const getStory = query({
  // A plain string, so an id that isn't a story (garbled, invented, another table's) is "not found", not an error.
  args: { storyId: v.string() },
  handler: async (ctx, args) => {
    const storyId = ctx.db.normalizeId("stories", args.storyId);
    if (!storyId) return null;
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
    const placeNames = new Map(livePlaces.map((place) => [place.mentionId, place.officialName ?? place.name]));
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
      imageUrl: story.imageUrl ?? null,
      mentions: mentions
        .filter((mention) => mention.entityType !== "place")
        .map(({ entityType, name, quote, startMs, relatedPlace }) => ({
          entityType, name, quote, startMs, relatedPlace: relatedPlace ?? null,
        })),
      places: livePlaces.map((place) => ({
        name: place.officialName ?? place.name,
        category: place.category,
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        neighborhood: place.neighborhood ?? null,
        address: place.geocodeLabel ?? null,
        quote: liveMentions.get(place.mentionId)!.quote,
      })),
      topics: topics.map(({ topic, confidence, quote }) => ({ topic, confidence, quote })),
      actions: actions.map((action) => ({
        kind: action.kind,
        label: action.label,
        quote: action.quote,
        place: action.placeMentionId
          ? (placeNames.get(action.placeMentionId) ?? liveMentions.get(action.placeMentionId)!.name)
          : null,
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
      let matched = mention.name;
      if (mention.entityType === "place") {
        const place = await ctx.db.query("places").withIndex("by_mentionId", (q) => q.eq("mentionId", mention._id)).unique();
        if (place?.reviewStatus !== "approved") continue;
        matched = place.officialName ?? mention.name;
      }
      results.set(mention.storyId, {
        storyId: mention.storyId,
        title: story.title,
        attribution: attribution(getShowProfile(story.showSlug).name, story.publishedAt),
        matched,
      });
    }
    return [...results.values()].slice(0, 10);
  },
});

/** Story-level search for Radio Commons: a listener's half-remembered words against published stories only. */
export const searchStoryCards = query({
  args: { text: v.string(), showSlug: v.optional(v.string()) },
  handler: async (ctx, { text, showSlug }) => {
    const search = normalizeForMatch(text);
    if (!search) return [];
    const hits = await ctx.db
      .query("stories")
      .withSearchIndex("search_story", (q) => {
        const published = q.search("searchText", search).eq("reviewStatus", "approved").eq("doNotUse", false);
        return showSlug ? published.eq("showSlug", showSlug) : published;
      })
      .take(10);
    return hits
      .filter((story) => story.summary && story.approvedRunId && relevantEnough(text, story.searchText ?? ""))
      .slice(0, 5)
      .map((story) => {
        const show = getShowProfile(story.showSlug).name;
        return {
          storyId: story._id, title: story.title, show, showSlug: story.showSlug,
          attribution: attribution(show, story.publishedAt), publishedAt: story.publishedAt,
          hint: firstSentence(story.summary!), imageUrl: story.imageUrl ?? null,
        };
      });
  },
});

const MAX_PASSAGES = 3;
const NO_PASSAGES = { passages: [] as { text: string; startMs: number; speaker: string | null }[] };

/**
 * Detail answers for Radio Commons: up to 3 short passages from one published episode's transcript, in episode order.
 * The transcript isn't editor-reviewed, so the switch (show default unless an editor set it) and the name guard are the contract.
 */
export const askStory = query({
  args: { storyId: v.string(), question: v.string() },
  handler: async (ctx, args) => {
    const storyId = ctx.db.normalizeId("stories", args.storyId);
    const story = storyId ? await ctx.db.get("stories", storyId) : null;
    const runId = story?.approvedRunId;
    if (!storyId || !story || !runId || story.reviewStatus !== "approved" || story.doNotUse) return { status: "not_found" as const, ...NO_PASSAGES };
    if (!allowsDetailedAnswers(story, getShowProfile(story.showSlug))) return { status: "not_allowed" as const, ...NO_PASSAGES };

    const wanted = detailWords(args.question.slice(0, 300));
    if (!wanted) return { status: "ok" as const, ...NO_PASSAGES };
    const mentions = await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
    const blocked = blockedNames(mentions, places);
    const names = await ctx.db.query("speakerNames").withIndex("by_storyId", (q) => q.eq("storyId", storyId)).take(MAX_ROWS_PER_RUN);
    const confirmed = new Map(names.filter((n) => n.source === "editor").map((n) => [n.label, n.name]));

    const hits = await ctx.db
      .query("transcriptSegments")
      .withSearchIndex("search_text", (q) => q.search("text", wanted).eq("storyId", storyId))
      .take(20);
    const passages = hits
      .filter((seg) => relevantEnough(wanted, normalizeForMatch(seg.text)))
      .filter((seg) => !mentionsBlocked(seg.text, blocked))
      // A passage spoken by someone whose name is blocked is skipped too: the guard beats a confirmed speaker name.
      .filter((seg) => !mentionsBlocked(confirmed.get(seg.speaker) ?? "", blocked))
      .slice(0, MAX_PASSAGES)
      .sort((a, b) => a.startMs - b.startMs)
      .map((seg) => ({ text: trimPassage(seg.text), startMs: seg.startMs, speaker: confirmed.get(seg.speaker) ?? null }));
    return { status: "ok" as const, passages };
  },
});

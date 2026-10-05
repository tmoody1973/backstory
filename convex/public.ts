import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { attribution } from "./lib/attribution";
import { allowsDetailedAnswers, clock, findPassages, passageAt, quotable, searchTerms, storyGuard } from "./lib/askStory";
import { normalizeForMatch } from "./lib/evidence";
import { getShowProfile, SHOW_PROFILES } from "./lib/shows";
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
      contentType: story.contentType,
      song: await publishedSong(ctx, storyId, runId),
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
        reservationUrl: place.reservationUrl ?? null,
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
    const found = hits
      .filter((story) => story.summary && story.approvedRunId && relevantEnough(text, story.searchText ?? ""))
      .slice(0, 5)
      .map((story) => storyCard(story, firstSentence(story.summary!)));
    return found.length ? found : await transcriptMatches(ctx, text, showSlug);
  },
});

function storyCard(story: Doc<"stories">, hint: string) {
  const show = getShowProfile(story.showSlug).name;
  return {
    storyId: story._id, title: story.title, show, showSlug: story.showSlug,
    attribution: attribution(show, story.publishedAt), publishedAt: story.publishedAt, hint, imageUrl: story.imageUrl ?? null,
  };
}

/**
 * When nothing published describes it ("the episode where they talked about stromboli"), look in the transcripts of
 * episodes whose detailed answers are on, under the same guard as askStory. The hint is the quote and its moment.
 */
async function transcriptMatches(ctx: QueryCtx, text: string, showSlug?: string) {
  const wanted = searchTerms(text.slice(0, MAX_QUESTION));
  if (!wanted) return [];
  const hits = await ctx.db.query("transcriptSegments").withSearchIndex("search_text", (q) => q.search("text", wanted)).take(50);
  const results = [];
  const seen = new Set<string>();
  for (const seg of hits) {
    if (results.length >= 3 || seen.has(seg.storyId)) continue;
    if (!relevantEnough(wanted, normalizeForMatch(seg.text))) continue;
    const story = await ctx.db.get("stories", seg.storyId);
    if (!quotable(story) || !story.summary || (showSlug && story.showSlug !== showSlug)) continue;
    if (!allowsDetailedAnswers(story, getShowProfile(story.showSlug))) continue;
    const passage = await passageAt(ctx, seg, await storyGuard(ctx, story));
    if (!passage) continue;
    seen.add(seg.storyId);
    // An article has no timeline: say whose words they are instead of "Mentioned at 0:00".
    const where = story.contentType === "premiere" ? "Radio Milwaukee's premiere says" : story.contentType === "session" ? "Radio Milwaukee's session write-up says" : `Mentioned at ${clock(passage.startMs)}`;
    results.push(storyCard(story, `${where}: "${passage.text}"`));
  }
  return results;
}

/** The newest published stories ("What's the latest This Bites?"). */
export const latestStoryCards = query({
  args: { showSlug: v.optional(v.string()) },
  handler: async (ctx, { showSlug }) => {
    // ponytail: scans the 50 newest published and filters by show; an index on (showSlug, reviewStatus, publishedAt) if a show gets buried
    const recent = await ctx.db
      .query("stories")
      .withIndex("by_reviewStatus_and_publishedAt", (q) => q.eq("reviewStatus", "approved"))
      .order("desc")
      .take(50);
    return recent
      .filter((story) => !story.doNotUse && story.summary && story.approvedRunId && (!showSlug || story.showSlug === showSlug))
      .slice(0, 3)
      .map((story) => storyCard(story, firstSentence(story.summary!)));
  },
});

const MAX_PASSAGES = 3;
const MAX_QUESTION = 500;
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
    if (!storyId || !quotable(story)) return { status: "not_found" as const, ...NO_PASSAGES };
    if (!allowsDetailedAnswers(story, getShowProfile(story.showSlug))) return { status: "not_allowed" as const, ...NO_PASSAGES };

    if (args.question.length > MAX_QUESTION) throw new ConvexError({ code: "question_too_long" });
    const wanted = searchTerms(args.question);
    if (!wanted) return { status: "ok" as const, ...NO_PASSAGES };
    const passages = await findPassages(ctx, story, wanted, MAX_PASSAGES);
    return { status: "ok" as const, passages };
  },
});

/** The approved song of the published run, as Alexa may use it; a session never carries audio. */
async function publishedSong(ctx: QueryCtx, storyId: Id<"stories">, runId: string) {
  const song = await ctx.db.query("songs").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).first();
  if (!song || song.reviewStatus !== "approved") return null;
  return {
    artist: song.artist, title: song.title ?? null, album: song.album ?? null, releaseDate: song.releaseDate ?? null,
    credits: song.credits, releaseShow: song.releaseShow ?? null, setList: song.setList ?? null,
    audioUrl: song.kind === "premiere" ? (song.audioUrl ?? null) : null,
  };
}

const PAGE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const SLUG_STOP = new Set(["the", "and", "for", "with", "milwaukee", "mke"]);
const MAX_URL = 500;

/**
 * The published story behind a radiomilwaukee.org page (the station briefing links newsletter items with it):
 * station stories by their own address; podcast pages (/podcast/<show>/<YYYY-MM-DD>/<slug>) by show, date (±2 days)
 * and every distinctive word of the address appearing in the title. Null when unsure: a wrong story is worse than none.
 */
export const storyForPage = query({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    if (url.length > MAX_URL) return null;
    let page: URL;
    try { page = new URL(url); } catch { return null; }
    if (page.hostname !== "radiomilwaukee.org") return null;
    // ponytail: scans the newest published stories; an index on permalink if the archive grows past a few hundred
    const published = (await ctx.db.query("stories").withIndex("by_reviewStatus_and_publishedAt", (q) => q.eq("reviewStatus", "approved")).order("desc").take(500))
      .filter((s) => quotable(s) && !!s.summary);
    const exact = published.find((s) => s.permalink === url);
    if (exact) return { storyId: exact._id, title: exact.title };
    const m = /^\/podcast\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\/([a-z0-9-]+)\/?$/.exec(page.pathname);
    if (!m || !SHOW_PROFILES[m[1]]) return null;
    const [, show, date, slug] = m;
    const words = slug.split("-").filter((w) => w.length >= 3 && !SLUG_STOP.has(w));
    if (words.length === 0) return null;
    const at = Date.parse(`${date}T12:00:00Z`);
    const candidates = published
      .filter((s) => s.showSlug === show && Math.abs(s.publishedAt - at) <= PAGE_DAYS_MS)
      .filter((s) => { const title = ` ${normalizeForMatch(s.title)} `; return words.every((w) => title.includes(` ${w} `)); })
      .sort((a, b) => Math.abs(a.publishedAt - at) - Math.abs(b.publishedAt - at));
    return candidates[0] ? { storyId: candidates[0]._id, title: candidates[0].title } : null;
  },
});

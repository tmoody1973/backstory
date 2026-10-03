import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeForMatch } from "./evidence";
import { SHOW_PROFILES } from "./shows";

// A run holds at most 40 mentions and 3 topics (extraction schema).
const MAX_ROWS_PER_RUN = 200;

/** What a listener might remember a story by: its title, published summary, topics and places. */
export function storySearchText(parts: { title: string; summary: string; topics: string[]; placeNames: string[] }): string {
  return normalizeForMatch([parts.title, parts.summary, ...parts.topics.map((t) => t.replace(/-/g, " ")), ...parts.placeNames].join(" "));
}

export function firstSentence(text: string, max = 140): string {
  const sentence = text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}

/** Recompute a story's search text from what is published right now; empty when nothing is (never missing, so every story is indexed the same way). */
export async function refreshStorySearch(ctx: MutationCtx, storyId: Id<"stories">): Promise<void> {
  const story = await ctx.db.get("stories", storyId);
  if (!story) return;
  const runId = story.approvedRunId;
  if (!runId || story.reviewStatus !== "approved" || !story.summary) {
    if (story.searchText !== "") await ctx.db.patch("stories", storyId, { searchText: "" });
    return;
  }
  const topics = await ctx.db.query("storyTopics").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  const mentions = await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  // Same rule as getStory: a place is live only while its mention is approved and not kept off Alexa.
  const liveMentions = new Set(mentions.filter((m) => m.reviewStatus === "approved" && !m.doNotUse).map((m) => m._id));
  const searchText = storySearchText({
    title: story.title,
    summary: story.summary,
    topics: topics.filter((t) => t.reviewStatus === "approved").map((t) => t.topic),
    placeNames: places.filter((p) => p.reviewStatus === "approved" && liveMentions.has(p.mentionId)).map((p) => p.officialName ?? p.name),
  });
  if (searchText !== story.searchText) await ctx.db.patch("stories", storyId, { searchText });
}

// Words a listener says that don't identify a story.
const FILLER = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "from", "with", "about", "that", "this", "was", "is", "it",
  "story", "stories", "episode", "show", "podcast", "radio", "milwaukee", "heard", "remember", "one", "some",
  // Show names ("the Uniquely Milwaukee story about…"): the show is a filter, not a memory of the story.
  ...Object.values(SHOW_PROFILES).flatMap((show) => normalizeForMatch(show.name).split(" ")),
]);
const stem = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);

/**
 * Convex search ranks any story that shares one word with the query. For a spoken answer that is too loose:
 * a story is a match only if at least half of the listener's meaningful words appear in it, and at least two
 * when they said two or more ("House of Correction" must not match a story about Bread House).
 * Words run together or split ("icecream" / "ice cream", "south side" / "Southside") count as the same.
 */
// ponytail: word overlap with a plural stem; swap for a scored ranker if listeners phrase things in ways this misses
export function relevantEnough(query: string, searchText: string): boolean {
  const wanted = [...new Set(normalizeForMatch(query).split(" ").filter((w) => w.length > 1 && !FILLER.has(w)).map(stem))];
  if (wanted.length === 0) return false;
  const words = searchText.split(" ");
  const have = new Set([...words, ...words.slice(1).map((w, i) => words[i] + w)].map(stem));
  const found = new Set(wanted.filter((w) => have.has(w)));
  wanted.slice(1).forEach((w, i) => {
    if (have.has(stem(wanted[i] + w))) found.add(wanted[i]).add(w);
  });
  return found.size >= Math.max(Math.ceil(wanted.length / 2), Math.min(2, wanted.length));
}

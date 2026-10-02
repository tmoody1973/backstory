import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeForMatch } from "./evidence";

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
  const searchText = storySearchText({
    title: story.title,
    summary: story.summary,
    topics: topics.filter((t) => t.reviewStatus === "approved").map((t) => t.topic),
    placeNames: places.filter((p) => p.reviewStatus === "approved").map((p) => p.officialName ?? p.name),
  });
  if (searchText !== story.searchText) await ctx.db.patch("stories", storyId, { searchText });
}

// Words a listener says that don't identify a story.
const FILLER = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "from", "with", "about", "that", "this", "was", "is", "it",
  "story", "stories", "episode", "show", "podcast", "radio", "milwaukee", "heard", "remember", "one", "some",
]);
const stem = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);

/**
 * Convex search ranks any story that shares one word with the query. For a spoken answer that is too loose:
 * a story is a match only if at least half of the listener's meaningful words appear in it.
 */
// ponytail: word overlap with a plural stem; swap for a scored ranker if listeners phrase things in ways this misses
export function relevantEnough(query: string, searchText: string): boolean {
  const wanted = [...new Set(normalizeForMatch(query).split(" ").filter((w) => w.length > 1 && !FILLER.has(w)).map(stem))];
  if (wanted.length === 0) return false;
  const have = new Set(searchText.split(" ").map(stem));
  const found = wanted.filter((w) => have.has(w)).length;
  return found >= Math.ceil(wanted.length / 2);
}

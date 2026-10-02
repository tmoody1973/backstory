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

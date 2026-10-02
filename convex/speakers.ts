import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Segment } from "./lib/evidence";
import { askJev, transcriptState } from "./lib/jevTopics";
import { getShowProfile } from "./lib/shows";
import { assignSpeakers, speakerCandidates, speakerLabels, speakerQuestions } from "./lib/speakers";

const MAX_ROWS = 200;

export const peopleFor = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    const runId = story?.latestRunId;
    if (!runId) return [];
    const mentions = await ctx.db
      .query("mentions")
      .withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId))
      .take(MAX_ROWS);
    return mentions.filter((m) => m.entityType === "person").map((m) => m.name);
  },
});

export const saveSuggestions = internalMutation({
  args: {
    storyId: v.id("stories"),
    suggestions: v.array(v.object({ label: v.string(), name: v.string(), confidence: v.number() })),
  },
  handler: async (ctx, { storyId, suggestions }) => {
    const existing = await ctx.db.query("speakerNames").withIndex("by_storyId", (q) => q.eq("storyId", storyId)).take(MAX_ROWS);
    const confirmedLabels = new Set(existing.filter((row) => row.source === "editor").map((row) => row.label));
    for (const row of existing) if (row.source === "suggested") await ctx.db.delete("speakerNames", row._id);
    for (const s of suggestions) {
      if (!confirmedLabels.has(s.label)) await ctx.db.insert("speakerNames", { storyId, ...s, source: "suggested" });
    }
  },
});

/**
 * Suggest real names for a story's transcript speakers (spk_0 → "Tarik Moody") for editors to confirm.
 *   npx convex run speakers:suggest '{"storyId":"..."}'
 */
export const suggest = internalAction({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }): Promise<Array<{ label: string; name: string; confidence: number }>> => {
    const key = process.env.TYPESAFE_API_KEY;
    if (!key) throw new Error("Missing Convex env var TYPESAFE_API_KEY");
    const input: { showSlug: string; teaserText: string; segments: Segment[] } = await ctx.runQuery(internal.extractions.loadInput, { storyId });
    const people: string[] = await ctx.runQuery(internal.speakers.peopleFor, { storyId });
    const labels = speakerLabels(input.segments);
    const candidates = speakerCandidates(getShowProfile(input.showSlug), input.teaserText, people);
    const run = await askJev(transcriptState(input.segments), speakerQuestions(labels, candidates), key);
    const suggestions = assignSpeakers(labels, run.answers);
    await ctx.runMutation(internal.speakers.saveSuggestions, { storyId, suggestions });
    return suggestions;
  },
});

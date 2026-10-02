import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Segment } from "./lib/evidence";
import { judgePeople, peopleQuestions } from "./lib/jevPeople";
import { askJev, transcriptState } from "./lib/jevTopics";

interface JudgeResult {
  kept: string[];
  dropped: Array<{ name: string; reason: string }>;
  inputTokens: number;
}

/**
 * Comparison only: Jev judges a list of people against a story's transcript. Writes nothing.
 *   npx convex run jevPeople:compare '{"storyId":"...","names":["..."]}'
 */
export const compare = internalAction({
  args: { storyId: v.id("stories"), names: v.array(v.string()) },
  handler: async (ctx, { storyId, names }): Promise<JudgeResult> => {
    if (names.length === 0) return { kept: [], dropped: [], inputTokens: 0 };
    const key = process.env.TYPESAFE_API_KEY;
    if (!key) throw new Error("Missing Convex env var TYPESAFE_API_KEY");
    const input: { segments: Segment[] } = await ctx.runQuery(internal.extractions.loadInput, { storyId });
    const run = await askJev(transcriptState(input.segments), peopleQuestions(names), key);
    return { ...judgePeople(names, run.answers), inputTokens: run.usage.input_tokens };
  },
});

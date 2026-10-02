import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildTranscriptIndex, findEvidence, type Segment } from "./lib/evidence";
import {
  askJev, evidenceQuestions, passageCandidates, pickEvidence, pickTopics, topicQuestions, transcriptState,
  type JevResponse,
} from "./lib/jevTopics";

function apiKey(): string {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("Missing Convex env var TYPESAFE_API_KEY");
  return key;
}

interface CompareResult {
  model: string;
  allTopicScores: Record<string, number | undefined>;
  topics: Array<{ topic: string; confidence: number; quote: string; startMs: number; speaker: string; evidenceFound: boolean }>;
  inputTokens: number;
}

/**
 * Comparison only (decision 007 pending): Jev picks a story's topics, then picks the transcript
 * passage that supports each one. Returns the result; writes nothing.
 *   npx convex run jevTopics:compare '{"storyId":"..."}'
 */
export const compare = internalAction({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }): Promise<CompareResult> => {
    const input: { title: string; segments: Segment[] } = await ctx.runQuery(internal.extractions.loadInput, { storyId });
    const state = transcriptState(input.segments);
    const topicRun = await askJev(state, topicQuestions(), apiKey());
    const topics = pickTopics(topicRun.answers);
    const candidates = passageCandidates(input.segments);
    const evidenceRun: JevResponse = topics.length
      ? await askJev(`Podcast episode: "${input.title}"`, evidenceQuestions(topics, candidates), apiKey())
      : { model: topicRun.model, answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
    const index = buildTranscriptIndex(input.segments);
    const picked = pickEvidence(topics, evidenceRun.answers, candidates).map((topic) => ({
      ...topic,
      evidenceFound: findEvidence(index, topic.quote) !== null,
    }));
    return {
      model: topicRun.model,
      allTopicScores: Object.fromEntries(Object.entries(topicRun.answers).map(([topic, answer]) => [topic, answer.noul])),
      topics: picked,
      inputTokens: topicRun.usage.input_tokens + evidenceRun.usage.input_tokens,
    };
  },
});

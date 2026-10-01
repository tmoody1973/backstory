import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildTranscriptIndex, findEvidence, type Segment } from "./lib/evidence";
import {
  evidenceQuestions, JEV_MODEL, JEV_URL, passageCandidates, pickEvidence, pickTopics, topicQuestions,
  transcriptState, type JevAnswer,
} from "./lib/jevTopics";

interface CompareResult {
  model: string;
  allTopicScores: Record<string, number | undefined>;
  topics: Array<{ topic: string; confidence: number; quote: string; startMs: number; speaker: string; evidenceFound: boolean }>;
  inputTokens: number;
}

interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

// ponytail: no retry on 429/529; this is a manual comparison run, add backoff if it joins the pipeline
async function askJev(state: string, questions: Record<string, unknown>): Promise<JevResponse> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("Missing Convex env var TYPESAFE_API_KEY");
  const response = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: JEV_MODEL, questions }),
  });
  if (!response.ok) throw new Error(`TypeSafe request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as JevResponse;
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
    const topicRun = await askJev(state, topicQuestions());
    const topics = pickTopics(topicRun.answers);
    const candidates = passageCandidates(input.segments);
    const evidenceRun: JevResponse = topics.length
      ? await askJev(`Podcast episode: "${input.title}"`, evidenceQuestions(topics, candidates))
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

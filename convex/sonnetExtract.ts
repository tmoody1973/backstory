import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildTranscriptIndex, type Segment } from "./lib/evidence";
import { applyEvidence, buildExtractionPrompt, extractionSchema, trimToCaps, type CheckedExtraction } from "./lib/extraction";
import { getShowProfile } from "./lib/shows";

const MODEL = "claude-sonnet-5-5";

interface SonnetResult {
  model: string;
  stopReason: string | null;
  result: Omit<CheckedExtraction, "dropped"> | null;
  dropped: CheckedExtraction["dropped"];
  inputTokens: number;
  outputTokens: number;
}

/**
 * Comparison only: the same prompt, schema and evidence check as the Haiku step, run on Claude
 * Sonnet 5.5 through the Anthropic API. Sonnet 5.5 rejects forced tool use, so this asks for
 * structured JSON output instead. Writes nothing.
 *   npx convex run sonnetExtract:compare '{"storyId":"..."}'
 */
export const compare = internalAction({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }): Promise<SonnetResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing Convex env var ANTHROPIC_API_KEY");
    const input: { showSlug: string; title: string; teaserText: string; publishedAt: number; segments: Segment[] } =
      await ctx.runQuery(internal.extractions.loadInput, { storyId });
    const profile = getShowProfile(input.showSlug);
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: "user", content: buildExtractionPrompt({ profile, ...input }) }],
      output_config: { format: zodOutputFormat(extractionSchema) },
    });
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return { model: MODEL, stopReason: response.stop_reason, result: null, dropped: [], ...usage };
    }
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const extraction = extractionSchema.parse(trimToCaps(JSON.parse(text)));
    const { dropped, ...result } = applyEvidence(extraction, buildTranscriptIndex(input.segments), profile);
    return { model: MODEL, stopReason: response.stop_reason, result, dropped, ...usage };
  },
});

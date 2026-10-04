"use node";

import { BedrockRuntimeClient, ConverseCommand, type ToolInputSchema } from "@aws-sdk/client-bedrock-runtime";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { buildTranscriptIndex } from "../lib/evidence";
import { checkSong, songEvidenceText } from "../lib/song";
import { applyEvidence, buildExtractionPrompt, extractionJsonSchema, extractionSchema, trimToCaps } from "../lib/extraction";
import { gentleJudge, peopleQuestions } from "../lib/jevPeople";
import { askJev, jevTopicsFor, transcriptState } from "../lib/jevTopics";
import { getShowProfile } from "../lib/shows";
import { runStep, stepArgs } from "../lib/steps";

// Claude Haiku 4.5 on Bedrock (decision 006): Nova Micro paraphrased quotes and Nova Lite broke on long episodes.
const DEFAULT_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const TOOL_NAME = "record_extraction";

export const run = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.aws.extract.run, async () => {
      const input = await ctx.runQuery(internal.extractions.loadInput, { storyId: args.storyId });
      const profile = getShowProfile(input.showSlug);
      const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
      const response = await client.send(
        new ConverseCommand({
          modelId: process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
          messages: [{ role: "user", content: [{ text: buildExtractionPrompt({ profile, ...input }) }] }],
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: TOOL_NAME,
                  description: "Record the people, places, dishes, topics and actions in this episode, each with its verbatim transcript quote.",
                  inputSchema: { json: extractionJsonSchema() as ToolInputSchema.JsonMember["json"] },
                },
              },
            ],
            // If this model rejects a named tool choice, use { any: {} }: there is only one tool.
            toolChoice: { tool: { name: TOOL_NAME } },
          },
          // A 22-minute food episode needed more than 4,096 output tokens; Haiku 4.5 allows far more.
          inferenceConfig: { maxTokens: 12_000, temperature: 0 },
        }),
      );
      const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
      console.log(
        `[backstory] ${args.storyId} model ${modelId} tokens in ${response.usage?.inputTokens} out ${response.usage?.outputTokens}`,
      );
      const toolUse = response.output?.message?.content?.find((block) => block.toolUse)?.toolUse;
      if (!toolUse?.input) throw new Error(`Model returned no ${TOOL_NAME} call (stopReason: ${response.stopReason})`);
      if (response.stopReason === "max_tokens") throw new Error("Model ran out of output tokens mid-extraction");
      const extraction = extractionSchema.parse(trimToCaps(toolUse.input)); // throws → retry → needs_editor
      const { dropped, ...checked } = applyEvidence(extraction, buildTranscriptIndex(input.segments), profile);
      // Decision 007: Jev's topics replace Haiku's (93% vs 67% accepted on the labeled set).
      // ponytail: Haiku still returns topics that are discarded here; drop them from its schema if token cost matters
      const typesafeKey = process.env.TYPESAFE_API_KEY;
      if (!typesafeKey) throw new Error("Missing Convex env var TYPESAFE_API_KEY");
      // Decision 008: Jev removes participants, students, patients, residents, minors and hosts,
      // and scores the rest so editors can sort passing mentions.
      const names = checked.mentions.filter((m) => m.entityType === "person").map((m) => m.name);
      const judged = names.length
        ? gentleJudge(names, (await askJev(transcriptState(input.segments), peopleQuestions(names), typesafeKey)).answers)
        : { kept: [], dropped: [] };
      for (const d of judged.dropped) console.log(`[backstory] ${args.storyId} people judge removed "${d.name}": ${d.reason}`);
      const confidence = new Map(judged.kept.map((k) => [k.name, k.subjectConfidence]));
      const mentions = checked.mentions.flatMap((m) =>
        m.entityType !== "person" ? [m] : confidence.has(m.name) ? [{ ...m, subjectConfidence: confidence.get(m.name) }] : [],
      );
      const excludeNames = judged.dropped.map((d) => d.name);
      const song = profile.contentType === "episode" ? null : checkSong(extraction.song, songEvidenceText(input.title, input.segments.map((s) => s.text)));
      const result = { ...checked, mentions, topics: await jevTopicsFor(input, typesafeKey, fetch, excludeNames), song };
      for (const item of dropped) console.log(`[backstory] ${args.storyId} dropped ${item.kind} "${item.name}": ${item.reason}`);
      await ctx.runMutation(internal.extractions.save, { ...args, runId: `${args.storyId}:${Date.now()}`, result });
    });
  },
});

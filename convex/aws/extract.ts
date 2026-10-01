"use node";

import { BedrockRuntimeClient, ConverseCommand, type ToolInputSchema } from "@aws-sdk/client-bedrock-runtime";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { buildTranscriptIndex } from "../lib/evidence";
import { applyEvidence, buildExtractionPrompt, extractionJsonSchema, extractionSchema, trimToCaps } from "../lib/extraction";
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
      const { dropped, ...result } = applyEvidence(extraction, buildTranscriptIndex(input.segments), profile);
      for (const item of dropped) console.log(`[backstory] ${args.storyId} dropped ${item.kind} "${item.name}": ${item.reason}`);
      await ctx.runMutation(internal.extractions.save, { ...args, runId: `${args.storyId}:${Date.now()}`, result });
    });
  },
});

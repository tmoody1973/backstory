"use node";

import { BedrockRuntimeClient, ConverseCommand, type ToolInputSchema } from "@aws-sdk/client-bedrock-runtime";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { buildTranscriptIndex } from "../lib/evidence";
import { applyEvidence, buildExtractionPrompt, extractionJsonSchema, extractionSchema } from "../lib/extraction";
import { getShowProfile } from "../lib/shows";
import { runStep, stepArgs } from "../lib/steps";

// Cross-region inference profile for Nova Micro. If Bedrock rejects it, check the console's model id for us-east-1.
const DEFAULT_MODEL_ID = "us.amazon.nova-micro-v1:0";
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
          inferenceConfig: { maxTokens: 4096, temperature: 0 },
        }),
      );
      const toolUse = response.output?.message?.content?.find((block) => block.toolUse)?.toolUse;
      if (!toolUse?.input) throw new Error(`Model returned no ${TOOL_NAME} call (stopReason: ${response.stopReason})`);
      const extraction = extractionSchema.parse(toolUse.input); // throws → retry → needs_editor
      const { dropped, ...result } = applyEvidence(extraction, buildTranscriptIndex(input.segments), profile);
      for (const item of dropped) console.log(`[backstory] ${args.storyId} dropped ${item.kind} "${item.name}": ${item.reason}`);
      await ctx.runMutation(internal.extractions.save, { ...args, runId: `${args.storyId}:${Date.now()}`, result });
    });
  },
});

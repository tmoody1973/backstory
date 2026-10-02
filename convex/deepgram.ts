import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { applyCorrections, DEEPGRAM_MODEL, DEEPGRAM_URL, deepgramKeyterms, parseUtterances } from "./lib/deepgram";
import nameCorrections from "./lib/nameCorrections.json";
import { getShowProfile } from "./lib/shows";
import { runStep, stepArgs } from "./lib/steps";

/**
 * Decision 009: transcribe with Deepgram Nova-3. Deepgram fetches the MP3 from its public URL (no S3 copy),
 * gets per-episode hints (hosts, known names, show-notes names), and known mishearings are corrected
 * before the transcript is saved. Bake-off: 84% of names right vs Transcribe's 74% (19 episodes).
 */
export const run = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.deepgram.run, async () => {
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) throw new Error("Missing Convex env var DEEPGRAM_API_KEY");
      const { audioUrl } = await ctx.runQuery(internal.transcripts.audioFor, { storyId: args.storyId });
      const story: { showSlug: string; teaserText: string } = await ctx.runQuery(internal.extractions.loadInput, { storyId: args.storyId });
      const knownNames = [...nameCorrections.names, ...nameCorrections.corrections.map((c) => c.correct)];
      const terms = deepgramKeyterms(getShowProfile(story.showSlug), story.teaserText, knownNames);
      const params = new URLSearchParams([
        ["model", DEEPGRAM_MODEL], ["smart_format", "true"], ["diarize", "true"], ["utterances", "true"],
        ...terms.map((term) => ["keyterm", term]),
      ]);
      const response = await fetch(`${DEEPGRAM_URL}?${params}`, {
        method: "POST",
        headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: audioUrl }),
      });
      if (!response.ok) throw new Error(`Deepgram request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
      const result = (await response.json()) as { metadata?: { request_id?: string } };
      const segments = parseUtterances(result).map((s) => ({ ...s, text: applyCorrections(s.text, nameCorrections.corrections) }));
      await ctx.runMutation(internal.transcripts.save, { ...args, ref: `deepgram:${result.metadata?.request_id ?? "unknown"}`, segments });
    });
  },
});

import { internal } from "./_generated/api";
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { articleParagraphs, type CdsArticle } from "./lib/article";
import { buildDocumentUrl, fetchCds } from "./lib/cds";
import { runStep, stepArgs } from "./lib/steps";

/**
 * Premieres and sessions: the article's paragraphs (lyrics removed) are stored where transcript lines go, so
 * extraction, evidence checks, search and ask-the-story work unchanged. No transcription, no audio.
 */
export const run = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.articles.run, async () => {
      const token = process.env.NPR_CDS_TOKEN;
      if (!token) throw new Error("Missing Convex env var NPR_CDS_TOKEN");
      const { cdsId } = await ctx.runQuery(internal.articles.cdsIdFor, { storyId: args.storyId });
      const url = buildDocumentUrl(cdsId);
      const body = (await fetchCds(url, token)) as { resources?: CdsArticle[] };
      const paragraphs = body.resources?.[0] ? articleParagraphs(body.resources[0]) : [];
      if (paragraphs.length === 0) throw new Error(`CDS article ${cdsId} has no text`);
      const segments = paragraphs.map((text) => ({ speaker: "article", startMs: 0, endMs: 0, text }));
      await ctx.runMutation(internal.transcripts.save, { ...args, ref: url, segments });
    });
  },
});

export const cdsIdFor = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    if (!story) throw new Error(`Story ${storyId} not found`);
    return { cdsId: story.cdsId };
  },
});

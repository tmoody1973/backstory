import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { enqueue } from "./jobs";
import { buildDocumentUrl } from "./lib/cds";

export const upsertEpisode = internalMutation({
  args: {
    showSlug: v.string(),
    cdsId: v.string(),
    title: v.string(),
    teaserText: v.string(),
    publishedAt: v.number(),
    audioUrl: v.string(),
    durationSec: v.number(),
    permalink: v.optional(v.string()),
  },
  handler: async (ctx, episode) => {
    // Mutations are serializable transactions, so two overlapping ingests can't both insert.
    const existing = await ctx.db
      .query("stories")
      .withIndex("by_cdsId", (q) => q.eq("cdsId", episode.cdsId))
      .unique();
    if (existing) {
      await ctx.db.patch("stories", existing._id, { title: episode.title, teaserText: episode.teaserText });
      return { storyId: existing._id, created: false };
    }
    const storyId = await ctx.db.insert("stories", {
      ...episode,
      contentType: "episode",
      stage: "ingested",
      reviewStatus: "pending",
      doNotUse: false,
    });
    await ctx.db.insert("sources", {
      storyId, kind: "cds_document", ref: buildDocumentUrl(episode.cdsId), fetchedAt: Date.now(),
    });
    await enqueue(ctx, "transcribe", storyId, internal.aws.transcribe.start);
    return { storyId, created: true };
  },
});

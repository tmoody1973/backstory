import { internal } from "./_generated/api";
import { getShowProfile } from "./lib/shows";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { enqueue, transcribeStep } from "./jobs";
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
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, episode) => {
    // Mutations are serializable transactions, so two overlapping ingests can't both insert.
    const existing = await ctx.db
      .query("stories")
      .withIndex("by_cdsId", (q) => q.eq("cdsId", episode.cdsId))
      .unique();
    if (existing) {
      await ctx.db.patch("stories", existing._id, {
        title: episode.title, teaserText: episode.teaserText, ...(episode.imageUrl ? { imageUrl: episode.imageUrl } : {}),
      });
      return { storyId: existing._id, created: false };
    }
    const profile = getShowProfile(episode.showSlug);
    const storyId = await ctx.db.insert("stories", {
      searchText: "", // filled when an editor publishes the story
      ...episode,
      // Decision 012: a session's audio is never kept, fetched or played.
      ...(profile.contentType === "session" ? { audioUrl: "" } : {}),
      contentType: profile.contentType,
      stage: "ingested",
      reviewStatus: "pending",
      doNotUse: false,
    });
    await ctx.db.insert("sources", {
      storyId, kind: "cds_document", ref: buildDocumentUrl(episode.cdsId), fetchedAt: Date.now(),
    });
    if (profile.contentType === "episode") await enqueue(ctx, "transcribe", storyId, transcribeStep());
    else await enqueue(ctx, "article", storyId, internal.articles.run);
    return { storyId, created: true };
  },
});

// A show has at most a few hundred episodes in Backstory (the This Bites archive is ~377).
const MAX_STORIES_PER_SHOW = 1000;

/** Backfill and keep current: give every story of a show its show artwork. */
export const setShowImage = internalMutation({
  args: { showSlug: v.string(), imageUrl: v.string() },
  handler: async (ctx, { showSlug, imageUrl }) => {
    const stories = await ctx.db
      .query("stories")
      .withIndex("by_showSlug_and_publishedAt", (q) => q.eq("showSlug", showSlug))
      .take(MAX_STORIES_PER_SHOW);
    let updated = 0;
    for (const story of stories) {
      if (story.imageUrl === imageUrl) continue;
      await ctx.db.patch("stories", story._id, { imageUrl });
      updated++;
    }
    return { updated };
  },
});

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildDocumentUrl, buildShowQueryUrl, fetchCds, parseEpisode, seriesImageUrl, type CdsDocument, type CdsEpisode } from "./lib/cds";
import { getShowProfile } from "./lib/shows";

export const ingestShow = internalAction({
  args: { showSlug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { showSlug, limit }) => {
    const profile = getShowProfile(showSlug);
    const token = process.env.NPR_CDS_TOKEN;
    if (!token) throw new Error("Missing Convex env var NPR_CDS_TOKEN");
    const imageUrl = await showImage(profile.cdsCollectionId, token);
    const body = (await fetchCds(buildShowQueryUrl(profile.cdsCollectionId, limit ?? 10, profile.cdsProfile), token)) as {
      resources?: CdsDocument[];
    };
    let created = 0;
    for (const doc of body.resources ?? []) {
      const episode = parseEpisode(doc);
      if (!episode) continue;
      const result = await ctx.runMutation(internal.stories.upsertEpisode, { showSlug, ...withImage(episode, imageUrl) });
      if (result.created) created++;
    }
    // Station stories (Ladies First) keep their own photos; the show artwork only backfills podcast shows.
    if (imageUrl && profile.cdsProfile === "podcast-episode") await ctx.runMutation(internal.stories.setShowImage, { showSlug, imageUrl });
    console.log(`[backstory] ingest ${showSlug}: ${body.resources?.length ?? 0} documents, ${created} new`);
    return { created };
  },
});

/**
 * Ingest specific episodes by CDS id (e.g. the labeled evaluation set), whatever their age:
 *   npx convex run ingest:ingestEpisodes '{"showSlug":"this-bites","cdsIds":["fis-..."]}'
 */
export const ingestEpisodes = internalAction({
  args: { showSlug: v.string(), cdsIds: v.array(v.string()) },
  handler: async (ctx, { showSlug, cdsIds }) => {
    const profile = getShowProfile(showSlug); // fails fast on an unknown show
    const token = process.env.NPR_CDS_TOKEN;
    if (!token) throw new Error("Missing Convex env var NPR_CDS_TOKEN");
    const imageUrl = await showImage(profile.cdsCollectionId, token);
    let created = 0;
    for (const cdsId of cdsIds) {
      const body = (await fetchCds(buildDocumentUrl(cdsId), token)) as { resources?: CdsDocument[] };
      const episode = body.resources?.[0] && parseEpisode(body.resources[0]);
      if (!episode) {
        console.log(`[backstory] ingest ${cdsId}: no audio, skipped`);
        continue;
      }
      const result = await ctx.runMutation(internal.stories.upsertEpisode, { showSlug, ...withImage(episode, imageUrl) });
      if (result.created) created++;
    }
    return { created };
  },
});

/** The show's artwork from its CDS series document; null if CDS has none. */
async function showImage(collectionId: string, token: string): Promise<string | null> {
  const series = (await fetchCds(buildDocumentUrl(collectionId), token)) as { resources?: Parameters<typeof seriesImageUrl>[0][] };
  return series.resources?.[0] ? seriesImageUrl(series.resources[0]) : null;
}

/** The episode's own photo when it has one, else the show artwork. */
function withImage(episode: CdsEpisode, showImageUrl: string | null): CdsEpisode {
  const imageUrl = episode.imageUrl ?? showImageUrl ?? undefined;
  return imageUrl ? { ...episode, imageUrl } : episode;
}

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildShowQueryUrl, fetchCds, parseEpisode, type CdsDocument } from "./lib/cds";
import { getShowProfile } from "./lib/shows";

export const ingestShow = internalAction({
  args: { showSlug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { showSlug, limit }) => {
    const profile = getShowProfile(showSlug);
    const token = process.env.NPR_CDS_TOKEN;
    if (!token) throw new Error("Missing Convex env var NPR_CDS_TOKEN");
    const body = (await fetchCds(buildShowQueryUrl(profile.cdsCollectionId, limit ?? 10), token)) as {
      resources?: CdsDocument[];
    };
    let created = 0;
    for (const doc of body.resources ?? []) {
      const episode = parseEpisode(doc);
      if (!episode) continue;
      const result = await ctx.runMutation(internal.stories.upsertEpisode, { showSlug, ...episode });
      if (result.created) created++;
    }
    console.log(`[backstory] ingest ${showSlug}: ${body.resources?.length ?? 0} documents, ${created} new`);
    return { created };
  },
});

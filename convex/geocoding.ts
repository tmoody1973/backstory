import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { markDone } from "./jobs";
import { normalizeForMatch } from "./lib/evidence";

// A run holds at most 40 mentions (extraction schema), so 200 is a safe ceiling.
const MAX_PLACES_PER_RUN = 200;

export const placesToGeocode = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get("stories", storyId);
    const runId = story?.latestRunId;
    if (!runId) return [];
    const places = await ctx.db
      .query("places")
      .withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId))
      .take(MAX_PLACES_PER_RUN);
    return places
      .filter((place) => place.geocodeConfidence === undefined)
      .map((place) => ({ placeId: place._id, name: place.name }));
  },
});

export const savePlaceGeocode = internalMutation({
  args: {
    placeId: v.id("places"),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    label: v.optional(v.string()),
    officialName: v.optional(v.string()),
    confidence: v.number(),
  },
  handler: async (ctx, { placeId, lat, lng, label, officialName, confidence }) => {
    await ctx.db.patch("places", placeId, { lat, lng, geocodeLabel: label, officialName, geocodeConfidence: confidence });
    if (!officialName) return;
    // Listeners search by the real name even when Transcribe misheard it.
    const place = await ctx.db.get("places", placeId);
    const mention = place && (await ctx.db.get("mentions", place.mentionId));
    if (mention) {
      await ctx.db.patch("mentions", mention._id, { searchText: `${mention.searchText} ${normalizeForMatch(officialName)}` });
    }
  },
});

export const finish = internalMutation({
  args: { jobId: v.id("jobs"), storyId: v.id("stories") },
  handler: async (ctx, { jobId, storyId }) => {
    await ctx.db.patch("stories", storyId, { stage: "geocoded" });
    await markDone(ctx, jobId);
  },
});

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeForMatch } from "./evidence";

// ponytail: a place's identity is its normalized name across episodes; two spellings stay two rows until a real place
// directory (or Field Guide venues via places.fieldGuideVenueId) replaces this.
const MAX_STORIES = 500;
const MAX_ROWS_PER_RUN = 200;

export const placeKey = (place: { name: string; officialName?: string }) => normalizeForMatch(place.officialName ?? place.name);

/** The runs that matter for a story: the one on the air and a newer one waiting for review. */
export const liveRuns = (story: Doc<"stories">) => [...new Set([story.approvedRunId, story.latestRunId].filter((r): r is string => Boolean(r)))];

/** Every place row in a live run of any story, with its story. */
export async function livePlaceRows(ctx: QueryCtx | MutationCtx): Promise<{ story: Doc<"stories">; place: Doc<"places"> }[]> {
  const out: { story: Doc<"stories">; place: Doc<"places"> }[] = [];
  for (const story of await ctx.db.query("stories").take(MAX_STORIES)) {
    for (const runId of liveRuns(story)) {
      const places = await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", story._id).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
      for (const place of places) out.push({ story, place });
    }
  }
  return out;
}

/** What an editor set on a place, by key, from any live run: carried onto new runs so re-processing never loses it. */
export async function editorPlaceDetails(ctx: MutationCtx) {
  const details = new Map<string, Partial<Pick<Doc<"places">, "neighborhood" | "reservationUrl" | "lat" | "lng" | "geocodeLabel" | "geocodeConfidence" | "phone" | "website" | "openingHours">>>();
  for (const { place } of await livePlaceRows(ctx)) {
    const key = placeKey(place);
    const known = details.get(key) ?? {};
    if (place.neighborhood && !known.neighborhood) known.neighborhood = place.neighborhood;
    if (place.reservationUrl && !known.reservationUrl) known.reservationUrl = place.reservationUrl;
    if (place.website && !known.website) Object.assign(known, { phone: place.phone, website: place.website, openingHours: place.openingHours });
    // A hand-set pin (confidence 1) is the editor's; automatic pins are recomputed by the geocoding step.
    if (place.geocodeConfidence === 1 && place.lat !== undefined && known.lat === undefined) {
      Object.assign(known, { lat: place.lat, lng: place.lng, geocodeLabel: place.geocodeLabel, geocodeConfidence: 1 });
    }
    details.set(key, known);
  }
  return details;
}

export type PlaceRowId = Id<"places">;

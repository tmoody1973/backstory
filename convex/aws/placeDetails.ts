"use node";

import { GeoPlacesClient, SearchTextCommand } from "@aws-sdk/client-geo-places";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { pickDetails } from "../lib/placeDetails";
import { requireReviewer } from "../lib/reviewAuth";

/**
 * "Fetch details": phone, website and opening hours for a pinned place from Amazon Location (Contact feature, stored use:
 * ~$0.004 per lookup, and we may keep the result). Saved on every live copy of the place.
 */
export const run = action({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ phone: string | null; website: string | null; openingHours: string | null }> => {
    await requireReviewer(ctx);
    const place = await ctx.runQuery(internal.reviewMutations.placeForDetails, { key });
    if (!place) throw new ConvexError({ code: "no_pin" });
    const client = new GeoPlacesClient({ region: process.env.AWS_REGION });
    const response = await client.send(
      new SearchTextCommand({
        QueryText: place.address ? `${place.name}, ${place.address}` : `${place.name}, Milwaukee, WI`,
        BiasPosition: [place.lng, place.lat],
        Filter: { IncludeCountries: ["USA"] },
        MaxResults: 3,
        AdditionalFeatures: ["Contact"],
        IntendedUse: "Storage", // we keep what comes back, which this pricing tier allows
      }),
    );
    const details = pickDetails(place.name, response.ResultItems ?? []);
    if (!details) throw new ConvexError({ code: "no_details" });
    await ctx.runMutation(internal.reviewMutations.saveDetails, { key, ...details });
    return { phone: details.phone ?? null, website: details.website ?? null, openingHours: details.openingHours ?? null };
  },
});

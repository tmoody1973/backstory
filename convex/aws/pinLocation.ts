"use node";

import { GeoPlacesClient, SearchTextCommand } from "@aws-sdk/client-geo-places";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { addressMatch, MILWAUKEE_CENTER, type GeoCandidate } from "../lib/geocode";
import { requireReviewer } from "../lib/reviewAuth";
import { placeCategoryValidator } from "../schema";

/** "Add location" / "Correct location": an editor types an address; Amazon Location turns it into a pin. */
export const run = action({
  args: { mentionId: v.id("mentions"), address: v.string(), category: placeCategoryValidator },
  handler: async (ctx, { mentionId, address, category }): Promise<{ label: string }> => {
    await requireReviewer(ctx);
    const query = address.trim();
    if (query.length < 5 || query.length > 200) throw new ConvexError({ code: "invalid_address" });
    const client = new GeoPlacesClient({ region: process.env.AWS_REGION });
    const response = await client.send(
      new SearchTextCommand({
        QueryText: query,
        BiasPosition: [...MILWAUKEE_CENTER],
        Filter: { IncludeCountries: ["USA"] },
        MaxResults: 1,
        IntendedUse: "Storage", // we keep the coordinates, which this pricing tier allows
      }),
    );
    const candidates: GeoCandidate[] = (response.ResultItems ?? []).flatMap((item) =>
      item.Title && item.Position
        ? [{ title: item.Title, position: [item.Position[0], item.Position[1]] as [number, number], distanceM: item.Distance, label: item.Address?.Label }]
        : [],
    );
    const match = addressMatch(candidates);
    if (!match) throw new ConvexError({ code: "no_match" });
    await ctx.runMutation(internal.reviewMutations.savePin, { mentionId, category, ...match });
    return { label: match.label };
  },
});

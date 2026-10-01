"use node";

import { GeoPlacesClient, SearchTextCommand } from "@aws-sdk/client-geo-places";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { geocodeDecision, MILWAUKEE_CENTER, type GeoCandidate } from "../lib/geocode";
import { runStep, stepArgs } from "../lib/steps";

export const run = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.aws.geocode.run, async () => {
      const client = new GeoPlacesClient({ region: process.env.AWS_REGION });
      const places = await ctx.runQuery(internal.geocoding.placesToGeocode, { storyId: args.storyId });
      for (const place of places) {
        const response = await client.send(
          new SearchTextCommand({
            QueryText: `${place.name}, Milwaukee, WI`,
            BiasPosition: [...MILWAUKEE_CENTER],
            Filter: { IncludeCountries: ["USA"] },
            MaxResults: 5,
            IntendedUse: "Storage", // we keep the coordinates, which this pricing tier allows
          }),
        );
        const candidates: GeoCandidate[] = (response.ResultItems ?? []).flatMap((item) =>
          item.Title && item.Position
            ? [{
                title: item.Title,
                position: [item.Position[0], item.Position[1]] as [number, number],
                distanceM: item.Distance,
                label: item.Address?.Label,
                placeType: item.PlaceType,
              }]
            : [],
        );
        await ctx.runMutation(internal.geocoding.savePlaceGeocode, { placeId: place.placeId, ...geocodeDecision(place.name, candidates) });
      }
      await ctx.runMutation(internal.geocoding.finish, args);
    });
  },
});

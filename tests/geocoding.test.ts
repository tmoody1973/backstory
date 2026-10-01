import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest, seedStory, type TestConvex } from "./helpers";

async function seedPlace(t: TestConvex, runId = "run-1") {
  const storyId = await seedStory(t, { stage: "extracted", latestRunId: "run-1" });
  return t.run(async (ctx) => {
    const mentionId = await ctx.db.insert("mentions", {
      storyId, runId, entityType: "place", name: "Café Corazón",
      quote: "a bittersweet farewell to Café Corazón in Bay View", startMs: 4000, speaker: "spk_1",
      reviewStatus: "pending", doNotUse: false, searchText: "cafe corazon",
    });
    const placeId = await ctx.db.insert("places", {
      storyId, runId, mentionId, name: "Café Corazón", category: "restaurant", reviewStatus: "pending",
    });
    const jobId = await ctx.db.insert("jobs", { kind: "geocode", storyId, status: "running", attempts: 0, updatedAt: 0 });
    return { storyId, placeId, jobId };
  });
}

describe("geocoding", () => {
  it("lists places from the latest run that have not been geocoded", async () => {
    const t = makeTest();
    const { storyId, placeId } = await seedPlace(t);
    expect(await t.query(internal.geocoding.placesToGeocode, { storyId })).toEqual([{ placeId, name: "Café Corazón" }]);
  });

  it("ignores places from older runs", async () => {
    const t = makeTest();
    const { storyId } = await seedPlace(t, "run-0");
    expect(await t.query(internal.geocoding.placesToGeocode, { storyId })).toEqual([]);
  });

  it("does not retry a place that found no match", async () => {
    const t = makeTest();
    const { storyId, placeId } = await seedPlace(t);
    await t.mutation(internal.geocoding.savePlaceGeocode, { placeId, confidence: 0 });
    expect(await t.query(internal.geocoding.placesToGeocode, { storyId })).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get("places", placeId)))?.lat).toBeUndefined();
  });

  it("stores coordinates and confidence", async () => {
    const t = makeTest();
    const { placeId } = await seedPlace(t);
    await t.mutation(internal.geocoding.savePlaceGeocode, {
      placeId, lat: 43.0, lng: -87.9, label: "2394 S Kinnickinnic Ave", confidence: 1,
    });
    expect(await t.run((ctx) => ctx.db.get("places", placeId))).toMatchObject({ lat: 43.0, lng: -87.9, geocodeConfidence: 1 });
  });

  it("finishes the step: story geocoded, job done", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedPlace(t);
    await t.mutation(internal.geocoding.finish, { jobId, storyId });
    expect((await t.run((ctx) => ctx.db.get("stories", storyId)))?.stage).toBe("geocoded");
    expect((await t.run((ctx) => ctx.db.get("jobs", jobId)))?.status).toBe("done");
  });
});

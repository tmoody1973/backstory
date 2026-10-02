import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, SAMPLE_RESULT, saveRun, seedStory, type TestConvex } from "./helpers";

async function geocodePlaces(t: TestConvex, confidence: number) {
  await t.run(async (ctx) => {
    for (const place of await ctx.db.query("places").collect()) {
      await ctx.db.patch("places", place._id, confidence >= 0.6 ? { lat: 43.0, lng: -87.9, geocodeConfidence: confidence } : { geocodeConfidence: confidence });
    }
  });
}

async function extractedStory(t: TestConvex, placeConfidence = 1) {
  const storyId = await seedStory(t, { stage: "geocoded" });
  await saveRun(t, storyId, "run-1");
  await geocodePlaces(t, placeConfidence);
  return storyId;
}

const approve = (t: TestConvex, storyId: Id<"stories">) =>
  t.mutation(internal.admin.approveLatestRunForDemo, { storyId });

describe("public.getStory", () => {
  it("returns nothing for an unapproved story", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    expect(await t.query(api.public.getStory, { storyId })).toBeNull();
  });

  it("returns the approved story with its place, action and attribution", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    const story = await t.query(api.public.getStory, { storyId });
    expect(story).toMatchObject({
      show: "This Bites",
      summary: SAMPLE_RESULT.summary,
      attribution: "This Bites, September 2026",
      places: [{ name: "Café Corazón", category: "restaurant", lat: 43.0, quote: "a bittersweet farewell to Café Corazón in Bay View" }],
      mentions: [{ entityType: "person", name: "Joe Sasto" }],
      topics: [{ topic: "food-drink" }],
      actions: [{ kind: "visit", label: "Visit Café Corazón in Riverwest", place: "Café Corazón" }],
    });
  });

  it("re-processing keeps the approved run live until the new run is approved", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    await saveRun(t, storyId, "run-2", { ...SAMPLE_RESULT, summary: "A newer summary.", mentions: [], actions: [] });

    const during = await t.query(api.public.getStory, { storyId });
    expect(during?.summary).toBe(SAMPLE_RESULT.summary);
    expect(during?.places).toHaveLength(1);

    await approve(t, storyId);
    const after = await t.query(api.public.getStory, { storyId });
    expect(after?.summary).toBe("A newer summary.");
    expect(after?.places).toHaveLength(0);
  });

  it("hides a story an editor marked not for assistant use", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    await t.run((ctx) => ctx.db.patch("stories", storyId, { doNotUse: true }));
    expect(await t.query(api.public.getStory, { storyId })).toBeNull();
  });

  it("hides a rejected or do-not-use mention, and the place and action that hang off it", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    await t.run(async (ctx) => {
      const mentions = await ctx.db.query("mentions").collect();
      await ctx.db.patch("mentions", mentions.find((m) => m.name === "Café Corazón")!._id, { doNotUse: true });
      await ctx.db.patch("mentions", mentions.find((m) => m.name === "Joe Sasto")!._id, { reviewStatus: "rejected" });
    });
    const story = await t.query(api.public.getStory, { storyId });
    expect(story?.mentions).toEqual([]);
    expect(story?.places).toEqual([]);
    expect(story?.actions).toEqual([]);
  });
});

describe("official place names", () => {
  it("getStory and searchStories use the business's own spelling", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    const place = await t.run(async (ctx) => (await ctx.db.query("places").collect())[0]);
    await t.mutation(internal.geocoding.savePlaceGeocode, {
      placeId: place._id, lat: 43.0, lng: -87.9, officialName: "Cafe Corazon Riverwest", confidence: 1,
    });
    await approve(t, storyId);
    const story = await t.query(api.public.getStory, { storyId });
    expect(story?.places[0].name).toBe("Cafe Corazon Riverwest");
    expect(story?.actions[0].place).toBe("Cafe Corazon Riverwest");
    expect(await t.query(api.public.searchStories, { text: "Riverwest" })).toMatchObject([{ matched: "Cafe Corazon Riverwest" }]);
  });
});

describe("place review gates", () => {
  it("demo approval leaves low-confidence places, and the actions that use them, for an editor", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t, 0.5);
    await approve(t, storyId);
    const story = await t.query(api.public.getStory, { storyId });
    expect(story?.places).toEqual([]);
    expect(story?.actions).toEqual([]);
    const place = await t.run(async (ctx) => (await ctx.db.query("places").collect())[0]);
    expect(place.reviewStatus).toBe("pending");
  });

  it("a rejected place no longer appears by name in actions or search", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    await t.run(async (ctx) => {
      const place = (await ctx.db.query("places").collect())[0];
      await ctx.db.patch("places", place._id, { reviewStatus: "rejected" });
    });
    const story = await t.query(api.public.getStory, { storyId });
    expect(story?.places).toEqual([]);
    expect(story?.actions).toEqual([]);
    expect(await t.query(api.public.searchStories, { text: "Corazon" })).toEqual([]);
  });
});

describe("public.searchStories", () => {
  it("finds nothing before approval", async () => {
    const t = makeTest();
    await extractedStory(t);
    expect(await t.query(api.public.searchStories, { text: "Corazon" })).toEqual([]);
  });

  it("finds an approved story by place name, ignoring accents", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    expect(await t.query(api.public.searchStories, { text: "Corazon" })).toEqual([
      { storyId, title: expect.any(String), attribution: "This Bites, September 2026", matched: "Café Corazón" },
    ]);
  });
});

describe("admin.approveLatestRunForDemo", () => {
  it("refuses a story with no extraction yet", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    await expect(approve(t, storyId)).rejects.toThrow("Story has no extraction run to approve yet");
  });
});

describe("admin.reextract", () => {
  it("queues a new extraction for a transcribed story", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await t.run((ctx) =>
      ctx.db.insert("transcriptSegments", { storyId, idx: 0, speaker: "spk_0", startMs: 0, endMs: 4000, text: "Welcome back to This Bites." }),
    );
    await t.mutation(internal.admin.reextract, { storyId });
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.filter((j) => j.kind === "extract" && j.status === "queued")).toHaveLength(1);
  });

  it("refuses a story that has no transcript yet", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribing" });
    await expect(t.mutation(internal.admin.reextract, { storyId })).rejects.toThrow("has no transcript yet");
  });
});

describe("admin.retranscribe", () => {
  it("queues a fresh transcription job for an existing story", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "geocoded" });
    await t.mutation(internal.admin.retranscribe, { storyId });
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs).toMatchObject([{ kind: "transcribe", status: "queued" }]);
    expect(jobs[0].externalId).toBeUndefined();
  });
});

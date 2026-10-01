import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, SAMPLE_RESULT, saveRun, seedStory, type TestConvex } from "./helpers";

async function extractedStory(t: TestConvex) {
  const storyId = await seedStory(t, { stage: "geocoded" });
  await saveRun(t, storyId, "run-1");
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
      places: [{ name: "Café Corazón", category: "restaurant", lat: null, quote: "a bittersweet farewell to Café Corazón in Bay View" }],
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

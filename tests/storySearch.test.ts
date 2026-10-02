import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { firstSentence, storySearchText } from "../convex/lib/storySearch";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "u", issuer: "https://clerk.test" };
beforeEach(() => {
  process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
});
afterEach(() => {
  delete process.env.BACKSTORY_REVIEWER_EMAILS;
});

async function published(t: TestConvex, overrides = {}) {
  const storyId = await seedStory(t, overrides);
  await saveRun(t, storyId, "run-1");
  await t.run(async (ctx) => {
    await ctx.db.patch("stories", storyId, { stage: "geocoded" });
    for (const p of await ctx.db.query("places").take(10)) await ctx.db.patch("places", p._id, { geocodeConfidence: 0.9, lat: 43, lng: -87.9 });
  });
  await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, {
    storyId, runId: "run-1", summary: "The hosts preview a festival. They visit a cafe.",
  });
  return storyId;
}

describe("storySearchText / firstSentence", () => {
  it("joins title, summary, topics and places into one normalized string", () => {
    expect(storySearchText({ title: "Café Corazón", summary: "A farewell.", topics: ["food-drink"], placeNames: ["Bay View"] }))
      .toBe("cafe corazon a farewell food drink bay view");
  });
  it("cuts the hint at the first sentence", () => {
    expect(firstSentence("The hosts preview a festival. They visit a cafe.")).toBe("The hosts preview a festival.");
  });
});

describe("public.searchStoryCards", () => {
  it("finds a published story by words in its summary", async () => {
    const t = makeTest();
    const storyId = await published(t);
    const [hit] = await t.query(api.public.searchStoryCards, { text: "festival" });
    expect(hit).toMatchObject({ storyId, show: "This Bites", showSlug: "this-bites", hint: "The hosts preview a festival." });
  });

  it("never returns an unpublished or keep-off-Alexa story", async () => {
    const t = makeTest();
    const draft = await seedStory(t, { cdsId: "draft" });
    await saveRun(t, draft, "run-1");
    expect(await t.query(api.public.searchStoryCards, { text: "festival" })).toEqual([]);
    const storyId = await published(t, { cdsId: "live" });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setDoNotUse, { target: { table: "stories", id: storyId }, doNotUse: true });
    expect(await t.query(api.public.searchStoryCards, { text: "festival" })).toEqual([]);
  });

  it("search follows edits after publishing: a removed place stops matching", async () => {
    const t = makeTest();
    const storyId = await published(t, { title: "Festival preview" });
    expect(await t.query(api.public.searchStoryCards, { text: "Corazón" })).toHaveLength(1);
    const [place] = await t.run((ctx) => ctx.db.query("places").take(1));
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "places", id: place._id }, status: "rejected", reason: "wrong" });
    expect(await t.query(api.public.searchStoryCards, { text: "Corazón" })).toEqual([]);
    expect((await t.mutation(internal.admin.refreshAllStorySearch, {})).refreshed).toBeGreaterThanOrEqual(1);
    expect((await t.query(api.public.searchStoryCards, { text: "festival" }))[0].storyId).toBe(storyId);
  });

  it("filters by show and returns nothing for blank text", async () => {
    const t = makeTest();
    await published(t);
    expect(await t.query(api.public.searchStoryCards, { text: "festival", showSlug: "uniquely-milwaukee" })).toEqual([]);
    expect(await t.query(api.public.searchStoryCards, { text: "   " })).toEqual([]);
  });
});

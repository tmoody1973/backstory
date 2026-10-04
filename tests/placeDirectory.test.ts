import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "u", issuer: "https://clerk.test" };
beforeEach(() => { process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org"; });
afterEach(() => { delete process.env.BACKSTORY_REVIEWER_EMAILS; });

async function published(t: TestConvex, cdsId: string) {
  const storyId = await seedStory(t, { cdsId });
  await saveRun(t, storyId, "run-1");
  await t.run(async (ctx) => {
    await ctx.db.patch("stories", storyId, { stage: "geocoded" });
    for (const p of await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", "run-1")).collect()) {
      await ctx.db.patch("places", p._id, { geocodeConfidence: 0.9, lat: 43, lng: -87.9 });
    }
  });
  await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: "A festival story." });
  return storyId;
}
const placesNamed = (t: TestConvex, name: string) => t.run(async (ctx) => (await ctx.db.query("places").collect()).filter((p) => p.name === name));

describe("Places & Organizations directory", () => {
  it("one row per published place across episodes, with the episodes it's in; unpublished stories don't count", async () => {
    const t = makeTest();
    const a = await published(t, "fis-a");
    const b = await published(t, "fis-b");
    const draft = await seedStory(t, { cdsId: "fis-c" });
    await saveRun(t, draft, "run-1"); // processed, never published
    const rows = await t.withIdentity(REVIEWER).query(api.review.places, {});
    const cafe = rows.find((r) => r.name === "Café Corazón")!;
    expect(cafe).toMatchObject({ kind: "place", category: "restaurant", hasPin: true, neighborhood: null, reservationUrl: null });
    expect(cafe.stories.map((s) => s.storyId).sort()).toEqual([a, b].sort());
    expect(rows.filter((r) => r.name === "Café Corazón")).toHaveLength(1);
  });

  it("refuses anyone who isn't a reviewer", async () => {
    const t = makeTest();
    await expect(t.query(api.review.places, {})).rejects.toThrow(/not_signed_in/);
    await expect(t.mutation(api.reviewMutations.setPlaceDetails, { key: "cafe corazon", neighborhood: "Bay View" })).rejects.toThrow(/not_signed_in/);
  });

  it("an edit reaches the place in every published episode", async () => {
    const t = makeTest();
    const a = await published(t, "fis-a");
    const b = await published(t, "fis-b");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setPlaceDetails, {
      key: "cafe corazon", neighborhood: "Bay View", reservationUrl: "https://resy.com/cities/mke/venues/cafe-corazon",
    });
    for (const storyId of [a, b]) {
      expect((await t.query(api.public.getStory, { storyId }))?.places[0]).toMatchObject({ neighborhood: "Bay View", reservationUrl: "https://resy.com/cities/mke/venues/cafe-corazon" });
    }
    await expect(t.withIdentity(REVIEWER).mutation(api.reviewMutations.setPlaceDetails, { key: "cafe corazon", reservationUrl: "https://evil.example/x" })).rejects.toThrow(/invalid_reservation_url/);
    // Leaving a field out leaves it alone; null clears it.
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setPlaceDetails, { key: "cafe corazon", reservationUrl: null });
    expect((await t.query(api.public.getStory, { storyId: a }))?.places[0]).toMatchObject({ neighborhood: "Bay View", reservationUrl: null });
  });

  it("re-processing an episode keeps the editor's neighborhood, reservation link and hand-set pin", async () => {
    const t = makeTest();
    const a = await published(t, "fis-a");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setPlaceDetails, { key: "cafe corazon", neighborhood: "Bay View", reservationUrl: "https://www.opentable.com/r/cafe-corazon" });
    const [mention] = await t.run(async (ctx) => (await ctx.db.query("mentions").collect()).filter((m) => m.name === "Café Corazón"));
    await t.mutation(internal.reviewMutations.savePin, { mentionId: mention._id as Id<"mentions">, lat: 42.99, lng: -87.89, label: "2394 S Kinnickinnic Ave", category: "restaurant" });
    await saveRun(t, a, "run-2");
    const [fresh] = (await placesNamed(t, "Café Corazón")).filter((p) => p.runId === "run-2");
    expect(fresh).toMatchObject({ neighborhood: "Bay View", reservationUrl: "https://www.opentable.com/r/cafe-corazon", lat: 42.99, lng: -87.89, geocodeConfidence: 1 });
  });

  it("a hand-set pin reaches the same place in other episodes", async () => {
    const t = makeTest();
    await published(t, "fis-a");
    await published(t, "fis-b");
    const [mention] = await t.run(async (ctx) => (await ctx.db.query("mentions").collect()).filter((m) => m.name === "Café Corazón"));
    await t.mutation(internal.reviewMutations.savePin, { mentionId: mention._id as Id<"mentions">, lat: 42.99, lng: -87.89, label: "2394 S Kinnickinnic Ave", category: "restaurant" });
    for (const place of await placesNamed(t, "Café Corazón")) expect(place).toMatchObject({ lat: 42.99, lng: -87.89 });
  });
});

describe("saveDetails (Fetch details)", () => {
  it("stores phone, website and hours on the place in every published episode, and the directory shows them", async () => {
    const t = makeTest();
    await published(t, "fis-a");
    await published(t, "fis-b");
    await t.mutation(internal.reviewMutations.saveDetails, { key: "cafe corazon", phone: "+14145551234", website: "https://cafecorazon.example", openingHours: "Daily 11–9" });
    for (const p of await placesNamed(t, "Café Corazón")) expect(p).toMatchObject({ phone: "+14145551234", website: "https://cafecorazon.example", openingHours: "Daily 11–9" });
    expect((await t.withIdentity(REVIEWER).query(api.review.places, {})).find((r) => r.key === "cafe corazon")).toMatchObject({ website: "https://cafecorazon.example" });
  });
});

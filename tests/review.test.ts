import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "user_1", issuer: "https://clerk.test" };

beforeEach(() => {
  process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
});
afterEach(() => {
  delete process.env.BACKSTORY_REVIEWER_EMAILS;
});

/** Saving a run sets stage "extracted"; the geocode step then sets "geocoded". Tests skip the geocode step. */
async function geocoded(t: TestConvex, storyId: Id<"stories">) {
  await t.run((ctx) => ctx.db.patch("stories", storyId, { stage: "geocoded" }));
}

async function readyStory(t: TestConvex, overrides = {}) {
  const storyId = await seedStory(t, overrides);
  await saveRun(t, storyId, "run-1");
  await geocoded(t, storyId);
  await t.run(async (ctx) => {
    await ctx.db.insert("transcriptSegments", { storyId, idx: 0, speaker: "spk_0", startMs: 0, endMs: 3000, text: "Welcome to This Bites." });
    await ctx.db.insert("transcriptSegments", { storyId, idx: 1, speaker: "spk_1", startMs: 3000, endMs: 9000, text: "A bittersweet farewell to Café Corazón in Bay View." });
  });
  return storyId;
}

describe("review.queue", () => {
  it("lists episodes waiting for review, newest first, with the show's reviewer", async () => {
    const t = makeTest();
    const older = await readyStory(t, { cdsId: "a", publishedAt: 1 });
    const newer = await readyStory(t, { cdsId: "b", publishedAt: 2 });
    await seedStory(t, { cdsId: "c", stage: "transcribing" }); // not ready: not listed
    const rows = await t.withIdentity(REVIEWER).query(api.review.queue, {});
    expect(rows.map((row) => row.storyId)).toEqual([newer, older]);
    expect(rows[0]).toMatchObject({ showName: "This Bites", reviewer: "Tarik Moody", needsReview: "new" });
  });

  it("includes a failed pipeline and an approved story whose newer run awaits review", async () => {
    const t = makeTest();
    const failed = await seedStory(t, { cdsId: "f", stage: "needs_editor" });
    const live = await readyStory(t, { cdsId: "l" });
    await t.mutation(internal.admin.approveLatestRunForDemo, { storyId: live });
    expect((await t.withIdentity(REVIEWER).query(api.review.queue, {})).map((r) => r.storyId)).toEqual([failed]);
    await saveRun(t, live, "run-2");
    expect((await t.withIdentity(REVIEWER).query(api.review.queue, {})).map((r) => r.storyId)).toEqual([failed]); // still geocoding
    await geocoded(t, live);
    const rows = await t.withIdentity(REVIEWER).query(api.review.queue, {});
    expect(rows.find((r) => r.storyId === live)?.needsReview).toBe("reprocessed");
    expect(rows.find((r) => r.storyId === failed)?.needsReview).toBe("pipeline_failed");
  });

  it("filters by show", async () => {
    const t = makeTest();
    await readyStory(t, { cdsId: "tb" });
    const um = await readyStory(t, { cdsId: "um", showSlug: "uniquely-milwaukee" });
    const rows = await t.withIdentity(REVIEWER).query(api.review.queue, { showSlug: "uniquely-milwaukee" });
    expect(rows.map((r) => r.storyId)).toEqual([um]);
  });
});

describe("review.episode", () => {
  it("returns the latest run's items with quotes, speakers with a sample line, places low-confidence first", async () => {
    const t = makeTest();
    const storyId = await readyStory(t);
    const episode = await t.withIdentity(REVIEWER).query(api.review.episode, { storyId });
    expect(episode?.story).toMatchObject({ title: expect.any(String), latestRunId: "run-1", proposedSummary: expect.any(String) });
    expect(episode?.speakers).toEqual([
      { label: "spk_0", name: null, source: null, sample: "Welcome to This Bites.", startMs: 0, endMs: 3000 },
      { label: "spk_1", name: null, source: null, sample: "A bittersweet farewell to Café Corazón in Bay View.", startMs: 3000, endMs: 9000 },
    ]);
    expect(episode?.mentions.map((m) => m.name)).toEqual(["Joe Sasto"]); // places are listed under places
    expect(episode?.places[0]).toMatchObject({ name: "Café Corazón", quote: "a bittersweet farewell to Café Corazón in Bay View" });
    expect(episode?.topics[0]).toMatchObject({ topic: "food-drink", reviewStatus: "pending" });
    expect(episode?.actions[0]).toMatchObject({ label: "Visit Café Corazón in Riverwest", place: "Café Corazón" });
  });

  it("returns null for a story with no extraction yet", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    expect(await t.withIdentity(REVIEWER).query(api.review.episode, { storyId })).toBeNull();
  });
});

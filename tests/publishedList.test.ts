import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "u", issuer: "https://clerk.test" };
beforeEach(() => { process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org"; });
afterEach(() => { delete process.env.BACKSTORY_REVIEWER_EMAILS; });

async function publish(t: TestConvex, cdsId: string, showSlug = "this-bites") {
  const storyId = await seedStory(t, { cdsId, showSlug });
  await saveRun(t, storyId, "run-1");
  await t.run(async (ctx) => {
    await ctx.db.patch("stories", storyId, { stage: "geocoded" });
    for (const p of await ctx.db.query("places").collect()) await ctx.db.patch("places", p._id, { geocodeConfidence: 0.9, lat: 43, lng: -87.9 });
  });
  await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: "A story." });
  return storyId;
}

describe("review.published", () => {
  it("lists published episodes newest first, filtered by show; drafts never appear", async () => {
    const t = makeTest();
    const a = await publish(t, "fis-a");
    const draft = await seedStory(t, { cdsId: "fis-draft" });
    await saveRun(t, draft, "run-1");
    const rows = await t.withIdentity(REVIEWER).query(api.review.published, {});
    expect(rows.map((r) => r.storyId)).toEqual([a]);
    expect(rows[0]).toMatchObject({ showName: "This Bites", newVersionWaiting: false, doNotUse: false });
    expect(await t.withIdentity(REVIEWER).query(api.review.published, { showSlug: "ladies-first" })).toEqual([]);
  });

  it("flags an episode re-processed since it was published", async () => {
    const t = makeTest();
    const a = await publish(t, "fis-a");
    await saveRun(t, a, "run-2");
    expect((await t.withIdentity(REVIEWER).query(api.review.published, {}))[0]).toMatchObject({ storyId: a, newVersionWaiting: true });
  });

  it("is for reviewers only", async () => {
    await expect(makeTest().query(api.review.published, {})).rejects.toThrow(/not_signed_in/);
  });
});

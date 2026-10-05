import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "u", issuer: "https://clerk.test" };
beforeEach(() => { process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org"; });
afterEach(() => { delete process.env.BACKSTORY_REVIEWER_EMAILS; });

async function story(t: TestConvex, fields: Record<string, unknown>, publish = true): Promise<Id<"stories">> {
  const storyId = await seedStory(t, { cdsId: `c-${Math.random()}`, ...fields });
  await saveRun(t, storyId, "run-1");
  await t.run(async (ctx) => {
    await ctx.db.patch("stories", storyId, { stage: "geocoded" });
    for (const p of await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", "run-1")).collect()) {
      await ctx.db.patch("places", p._id, { geocodeConfidence: 0.9, lat: 43, lng: -87.9 });
    }
  });
  if (publish) await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: "A story." });
  return storyId;
}
const day = (d: number) => Date.UTC(2026, 8, d, 15);
const MWO = "https://radiomilwaukee.org/podcast/uniquely-milwaukee/2026-10-01/my-way-out-milwaukee";

describe("storyForPage", () => {
  it("a station story by its own address", async () => {
    const t = makeTest();
    const url = "https://radiomilwaukee.org/local-music/2026-10-01/new-milwaukee-music-glitzy";
    const id = await story(t, { showSlug: "milwaukee-music-premiere", contentType: "premiere", title: "Milwaukee Music Premiere: Glitzy, 'Effort'", permalink: url });
    expect(await t.query(api.public.storyForPage, { url })).toEqual({ storyId: id, title: "Milwaukee Music Premiere: Glitzy, 'Effort'" });
  });

  it("a podcast page by show, date and the address's title words; the other episode that week is not it", async () => {
    const t = makeTest();
    const mwo = await story(t, { showSlug: "uniquely-milwaukee", title: "Through tech and teaching, My Way Out provides a path forward", publishedAt: Date.UTC(2026, 9, 1, 15), permalink: "https://play.prx.org/x" });
    await story(t, { showSlug: "uniquely-milwaukee", title: "Creativity is sustainable, accessible at 414 Art Revival", publishedAt: day(30), permalink: "https://play.prx.org/y" });
    expect(await t.query(api.public.storyForPage, { url: MWO })).toEqual({ storyId: mwo, title: "Through tech and teaching, My Way Out provides a path forward" });
  });

  it("never an unpublished story, an unknown show, another site, or a too-long address", async () => {
    const t = makeTest();
    await story(t, { showSlug: "uniquely-milwaukee", title: "Through tech and teaching, My Way Out provides a path forward", publishedAt: Date.UTC(2026, 9, 1, 15) }, false);
    expect(await t.query(api.public.storyForPage, { url: MWO })).toBeNull();
    expect(await t.query(api.public.storyForPage, { url: "https://radiomilwaukee.org/podcast/cinebuds/2026-09-30/milwaukee-muslim-film-festival-2026-schedule" })).toBeNull();
    expect(await t.query(api.public.storyForPage, { url: "https://example.com/podcast/uniquely-milwaukee/2026-10-01/my-way-out" })).toBeNull();
    expect(await t.query(api.public.storyForPage, { url: `https://radiomilwaukee.org/${"x".repeat(600)}` })).toBeNull();
  });

  it("title words don't match but it's the show's only episode that Milwaukee day: that's it (live: 'art-resale-shop' vs '414 Art Revival')", async () => {
    const t = makeTest();
    const url = "https://radiomilwaukee.org/podcast/uniquely-milwaukee/2026-09-29/art-resale-shop-milwaukee";
    const art = await story(t, { showSlug: "uniquely-milwaukee", title: "Creativity is sustainable, accessible at 414 Art Revival", publishedAt: Date.UTC(2026, 8, 29, 16) });
    expect(await t.query(api.public.storyForPage, { url })).toEqual({ storyId: art, title: "Creativity is sustainable, accessible at 414 Art Revival" });
    await story(t, { showSlug: "uniquely-milwaukee", title: "Another story that day", publishedAt: Date.UTC(2026, 8, 29, 20) });
    expect(await t.query(api.public.storyForPage, { url })).toBeNull(); // two that day: unsure, so none
  });

  it("the same-day fallback counts episodes still in review: one published + one unpublished that day is unsure, so none", async () => {
    const t = makeTest();
    const url = "https://radiomilwaukee.org/podcast/uniquely-milwaukee/2026-09-29/art-resale-shop-milwaukee";
    await story(t, { showSlug: "uniquely-milwaukee", title: "A different published story", publishedAt: Date.UTC(2026, 8, 29, 14) });
    await story(t, { showSlug: "uniquely-milwaukee", title: "Creativity is sustainable, accessible at 414 Art Revival", publishedAt: Date.UTC(2026, 8, 29, 16) }, false);
    expect(await t.query(api.public.storyForPage, { url })).toBeNull();
  });

  it("a story more than two days from the address's date is not it", async () => {
    const t = makeTest();
    await story(t, { showSlug: "uniquely-milwaukee", title: "My Way Out returns", publishedAt: day(20) });
    expect(await t.query(api.public.storyForPage, { url: MWO })).toBeNull();
  });
});

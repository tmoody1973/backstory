import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "u", issuer: "https://clerk.test" };
beforeEach(() => { process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org"; });
afterEach(() => { delete process.env.BACKSTORY_REVIEWER_EMAILS; });

const GLITZY = { artist: "Glitzy", title: "Effort", credits: [] };
const TANK = { artist: "Tank & The Bangas", credits: [], setList: ["Boxes & Squares", "Move", "Don't Count Yourself Out"] };

/** A music story with its song saved in run-1; published unless told otherwise. */
async function musicStory(t: TestConvex, song: unknown, { kind = "premiere" as "premiere" | "session", publish = true } = {}) {
  const showSlug = kind === "premiere" ? "milwaukee-music-premiere" : "studio-milwaukee";
  const storyId = await seedStory(t, { showSlug, contentType: kind, title: `${kind} story`, publishedAt: Date.UTC(2026, 9, 1, 15) });
  const jobId = await t.run((ctx) => ctx.db.insert("jobs", { kind: "extract", storyId, status: "running", attempts: 0, updatedAt: 0 }));
  await t.mutation(internal.extractions.save, { jobId, storyId, runId: "run-1", result: { summary: "A song story.", mentions: [], topics: [], actions: [], song } as never });
  if (publish) {
    await t.run((ctx) => ctx.db.patch("stories", storyId, { stage: "geocoded" }));
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: "A song story." });
  }
  return storyId;
}
const songStory = (t: TestConvex, artist: string, title: string) => t.query(api.public.songStory, { artist, title });

describe("songStory: the station's own story about a song the playlist played", () => {
  it("finds a premiere by artist and title, ignoring case, punctuation and featured artists", async () => {
    const t = makeTest();
    const storyId = await musicStory(t, GLITZY);
    expect(await songStory(t, "GLITZY", "Effort (feat. Someone)")).toEqual({
      storyId, show: "Milwaukee Music Premiere", title: "premiere story", kind: "premiere", publishedAt: Date.UTC(2026, 9, 1, 15),
    });
  });

  it("finds a session when the song is in its set list", async () => {
    const t = makeTest();
    const storyId = await musicStory(t, TANK, { kind: "session" });
    expect(await songStory(t, "Tank and the Bangas", "dont count yourself out")).toMatchObject({ storyId, kind: "session" });
  });

  it("never matches on the artist alone", async () => {
    const t = makeTest();
    await musicStory(t, GLITZY);
    await musicStory(t, TANK, { kind: "session" });
    expect(await songStory(t, "Glitzy", "Another Song")).toBeNull();
    expect(await songStory(t, "Tank & The Bangas", "Another Song")).toBeNull();
  });

  it("ignores stories an editor hasn't published", async () => {
    const t = makeTest();
    await musicStory(t, GLITZY, { publish: false });
    expect(await songStory(t, "Glitzy", "Effort")).toBeNull();
  });

  it("ignores a song an editor rejected", async () => {
    const t = makeTest();
    await musicStory(t, GLITZY);
    const [song] = await t.run((ctx) => ctx.db.query("songs").collect());
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "songs", id: song._id as Id<"songs"> }, status: "rejected", reason: "wrong" });
    expect(await songStory(t, "Glitzy", "Effort")).toBeNull();
  });

  it("ignores a story marked not for assistant use", async () => {
    const t = makeTest();
    const storyId = await musicStory(t, GLITZY);
    await t.run((ctx) => ctx.db.patch("stories", storyId, { doNotUse: true }));
    expect(await songStory(t, "Glitzy", "Effort")).toBeNull();
  });
});

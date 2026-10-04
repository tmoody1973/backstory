import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "u", issuer: "https://clerk.test" };
beforeEach(() => { process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org"; });
afterEach(() => { delete process.env.BACKSTORY_REVIEWER_EMAILS; });

const SONG = {
  artist: "Glitzy", title: "Effort", album: "Say Sorry / You're Right", releaseDate: "2026-10-23",
  credits: [{ role: "mastering", name: "Carl Saff" }], releaseShow: { venue: "Sugar Maple", date: "2026-10-23" },
};

async function premiere(t: TestConvex, showSlug = "milwaukee-music-premiere", contentType: "premiere" | "session" = "premiere") {
  const storyId = await seedStory(t, { showSlug, contentType, title: "Milwaukee Music Premiere: Glitzy, 'Effort'", audioUrl: contentType === "premiere" ? "https://cpa.ds.npr.org/s921/audio/2026/09/glitzy-effort.mp3" : "" });
  const jobId = await t.run((ctx) => ctx.db.insert("jobs", { kind: "extract", storyId, status: "running", attempts: 0, updatedAt: 0 }));
  return { storyId, jobId };
}
const save = (t: TestConvex, storyId: Id<"stories">, jobId: Id<"jobs">, runId: string, song: unknown) =>
  t.mutation(internal.extractions.save, { jobId, storyId, runId, result: { summary: "Glitzy premiere their single.", mentions: [], topics: [], actions: [], song } as never });
const songs = (t: TestConvex) => t.run((ctx) => ctx.db.query("songs").collect());
async function publish(t: TestConvex, storyId: Id<"stories">, runId: string) {
  await t.run((ctx) => ctx.db.patch("stories", storyId, { stage: "geocoded" }));
  await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId, summary: "Glitzy premiere 'Effort'." });
}

describe("song records", () => {
  it("extraction saves a pending premiere song with the story's audio; none when there is no song", async () => {
    const t = makeTest();
    const { storyId, jobId } = await premiere(t);
    await save(t, storyId, jobId, "run-1", SONG);
    expect(await songs(t)).toMatchObject([{ storyId, runId: "run-1", kind: "premiere", artist: "Glitzy", title: "Effort", reviewStatus: "pending", audioUrl: "https://cpa.ds.npr.org/s921/audio/2026/09/glitzy-effort.mp3" }]);
    const other = await premiere(t);
    await save(t, other.storyId, other.jobId, "run-1", null);
    expect(await songs(t)).toHaveLength(1);
  });

  it("a session's song never carries audio", async () => {
    const t = makeTest();
    const { storyId, jobId } = await premiere(t, "studio-milwaukee", "session");
    await save(t, storyId, jobId, "run-1", { artist: "Tank & The Bangas", credits: [], setList: ["Move"] });
    const [song] = await songs(t);
    expect(song).toMatchObject({ kind: "session", setList: ["Move"] });
    expect(song.audioUrl).toBeUndefined();
  });

  it("review shows it, editors can fix fields and keep or remove it; Alexa sees it only once published", async () => {
    const t = makeTest();
    const { storyId, jobId } = await premiere(t);
    await save(t, storyId, jobId, "run-1", SONG);
    const reviewer = t.withIdentity(REVIEWER);
    const ep = await reviewer.query(api.review.episode, { storyId });
    expect(ep?.song).toMatchObject({ artist: "Glitzy", title: "Effort", reviewStatus: "pending" });
    expect(ep?.story.contentType).toBe("premiere");
    await reviewer.mutation(api.reviewMutations.setSongFields, { songId: ep!.song!.songId as Id<"songs">, album: "Say Sorry/You're Right" });
    await expect(reviewer.mutation(api.reviewMutations.setSongFields, { songId: ep!.song!.songId as Id<"songs">, releaseDate: "next week" })).rejects.toThrow(/invalid_song/);
    await expect(t.mutation(api.reviewMutations.setSongFields, { songId: ep!.song!.songId as Id<"songs">, album: "x" })).rejects.toThrow(/not_signed_in/);
    expect((await t.query(api.public.getStory, { storyId }))).toBeNull();
    await publish(t, storyId, "run-1");
    expect(await t.query(api.public.getStory, { storyId })).toMatchObject({ contentType: "premiere", song: { artist: "Glitzy", album: "Say Sorry/You're Right", audioUrl: "https://cpa.ds.npr.org/s921/audio/2026/09/glitzy-effort.mp3" } });
    await reviewer.mutation(api.reviewMutations.decideItem, { item: { table: "songs", id: ep!.song!.songId as Id<"songs"> }, status: "rejected", reason: "wrong" });
    expect((await t.query(api.public.getStory, { storyId }))?.song).toBeNull();
  });

  it("re-processing keeps the published song live until the new run is approved", async () => {
    const t = makeTest();
    const { storyId, jobId } = await premiere(t);
    await save(t, storyId, jobId, "run-1", SONG);
    await publish(t, storyId, "run-1");
    const job2 = await t.run((ctx) => ctx.db.insert("jobs", { kind: "extract", storyId, status: "running", attempts: 0, updatedAt: 0 }));
    await save(t, storyId, job2, "run-2", { ...SONG, title: "Effort (radio edit)" });
    expect((await t.query(api.public.getStory, { storyId }))?.song).toMatchObject({ title: "Effort" });
  });

  it("episodes report their content type and no song", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    const jobId = await t.run((ctx) => ctx.db.insert("jobs", { kind: "extract", storyId, status: "running", attempts: 0, updatedAt: 0 }));
    await save(t, storyId, jobId, "run-1", null);
    await publish(t, storyId, "run-1");
    expect(await t.query(api.public.getStory, { storyId })).toMatchObject({ contentType: "episode", song: null });
  });
});

describe("review fixes", () => {
  it("re-transcribing a premiere re-reads its article, never the song audio (no sung lyrics)", async () => {
    const t = makeTest();
    const { storyId } = await premiere(t);
    await t.mutation(internal.admin.retranscribe, { storyId });
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.at(-1)).toMatchObject({ kind: "article", status: "queued" });
  });

  it("a transcript search hit in an article says whose words, not 'Mentioned at 0:00'", async () => {
    const t = makeTest();
    const { storyId, jobId } = await premiere(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("transcriptSegments", { storyId, idx: 0, speaker: "article", startMs: 0, endMs: 0, text: "Glitzy are rock-solid residents of the city's live environment and their stromboliesque energy." });
    });
    await save(t, storyId, jobId, "run-1", SONG);
    await publish(t, storyId, "run-1");
    const cards = await t.query(api.public.searchStoryCards, { text: "stromboliesque energy" });
    expect(cards[0]?.hint).toMatch(/^Radio Milwaukee's premiere says: "/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { parseEpisode, type CdsDocument } from "../convex/lib/cds";
import fixture from "./fixtures/cds-premiere-glitzy.json";
import { makeTest } from "./helpers";

const premiere = parseEpisode(fixture as unknown as CdsDocument)!;
afterEach(() => { vi.unstubAllGlobals(); delete process.env.NPR_CDS_TOKEN; });

describe("music articles enter the pipeline as text", () => {
  it("a premiere is a premiere story whose first job reads the article, not the audio", async () => {
    const t = makeTest();
    const { storyId } = await t.mutation(internal.stories.upsertEpisode, { showSlug: "milwaukee-music-premiere", ...premiere });
    const state = await t.run(async (ctx) => ({ story: await ctx.db.get("stories", storyId), jobs: await ctx.db.query("jobs").collect() }));
    expect(state.story).toMatchObject({ contentType: "premiere", audioUrl: "https://cpa.ds.npr.org/s921/audio/2026/09/glitzy-effort.mp3" });
    expect(state.jobs).toMatchObject([{ kind: "article", status: "queued" }]);
  });

  it("a session keeps no audio link (decision 012)", async () => {
    const t = makeTest();
    const { storyId } = await t.mutation(internal.stories.upsertEpisode, { showSlug: "studio-milwaukee", ...premiere, cdsId: "g-s921-15481" });
    expect(await t.run((ctx) => ctx.db.get("stories", storyId))).toMatchObject({ contentType: "session", audioUrl: "" });
  });

  it("the article job stores the paragraphs in order, without lyrics, then queues extraction", async () => {
    const t = makeTest();
    process.env.NPR_CDS_TOKEN = "test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ resources: [fixture] }), { status: 200 })));
    const { storyId } = await t.mutation(internal.stories.upsertEpisode, { showSlug: "milwaukee-music-premiere", ...premiere });
    const [job] = await t.run((ctx) => ctx.db.query("jobs").collect());
    await t.action(internal.articles.run, { jobId: job._id, storyId });
    const state = await t.run(async (ctx) => ({
      story: await ctx.db.get("stories", storyId),
      segments: await ctx.db.query("transcriptSegments").withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId)).collect(),
      jobs: await ctx.db.query("jobs").collect(),
    }));
    expect(state.story?.stage).toBe("transcribed");
    expect(state.segments[0]).toMatchObject({ idx: 0, speaker: "article", startMs: 0, endMs: 0 });
    expect(state.segments.some((s) => s.text.includes("Unless I go back"))).toBe(false);
    expect(state.segments.at(-1)?.text).toMatch(/Sugar Maple/);
    expect(state.jobs.map((j) => [j.kind, j.status])).toEqual([["article", "done"], ["extract", "queued"]]);
  });

  it("podcast shows still transcribe", async () => {
    const t = makeTest();
    await t.mutation(internal.stories.upsertEpisode, { showSlug: "this-bites", ...premiere, cdsId: "fis-x" });
    expect((await t.run((ctx) => ctx.db.query("jobs").collect()))[0].kind).toBe("transcribe");
  });
});

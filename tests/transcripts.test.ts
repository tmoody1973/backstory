import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { TEST_SEGMENTS } from "./fixtures/segments";
import { makeTest, seedStory, type TestConvex } from "./helpers";

async function seedTranscribeJob(t: TestConvex) {
  const storyId = await seedStory(t);
  const jobId = await t.run((ctx) =>
    ctx.db.insert("jobs", { kind: "transcribe", storyId, status: "running", attempts: 0, updatedAt: 0 }),
  );
  return { storyId, jobId };
}

describe("transcripts", () => {
  it("records the Transcribe job name and marks the story transcribing", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedTranscribeJob(t);
    await t.mutation(internal.transcripts.markTranscribing, { jobId, storyId, externalId: "backstory-x-1" });
    expect(await t.query(internal.transcripts.jobExternalId, { jobId })).toEqual({ externalId: "backstory-x-1" });
    expect((await t.run((ctx) => ctx.db.get("stories", storyId)))?.stage).toBe("transcribing");
  });

  it("saves segments in order, records the source, and queues extraction", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedTranscribeJob(t);
    await t.mutation(internal.transcripts.save, { jobId, storyId, ref: "s3://bucket/transcripts/x.json", segments: TEST_SEGMENTS });
    const state = await t.run(async (ctx) => ({
      story: await ctx.db.get("stories", storyId),
      job: await ctx.db.get("jobs", jobId),
      segments: await ctx.db.query("transcriptSegments").withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId)).collect(),
      sources: await ctx.db.query("sources").collect(),
      jobs: await ctx.db.query("jobs").collect(),
    }));
    expect(state.story?.stage).toBe("transcribed");
    expect(state.job?.status).toBe("done");
    expect(state.segments.map((s) => s.idx)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(state.sources).toMatchObject([{ kind: "transcript", ref: "s3://bucket/transcripts/x.json" }]);
    expect(state.jobs.filter((j) => j.kind === "extract" && j.status === "queued")).toHaveLength(1);
  });

  it("replaces an earlier transcript instead of appending to it", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedTranscribeJob(t);
    await t.mutation(internal.transcripts.save, { jobId, storyId, ref: "s3://a", segments: TEST_SEGMENTS });
    await t.mutation(internal.transcripts.save, { jobId, storyId, ref: "s3://b", segments: TEST_SEGMENTS.slice(0, 2) });
    const count = (await t.run((ctx) => ctx.db.query("transcriptSegments").collect())).length;
    expect(count).toBe(2);
  });
});

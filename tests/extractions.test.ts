import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { TEST_SEGMENTS } from "./fixtures/segments";
import { makeTest, SAMPLE_RESULT, saveRun, seedStory } from "./helpers";

describe("extractions.loadInput", () => {
  it("returns the story and its transcript in order", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    await t.run(async (ctx) => {
      for (const [idx, segment] of TEST_SEGMENTS.entries()) await ctx.db.insert("transcriptSegments", { storyId, idx, ...segment });
    });
    const input = await t.query(internal.extractions.loadInput, { storyId });
    expect(input.showSlug).toBe("this-bites");
    expect(input.segments).toEqual(TEST_SEGMENTS);
  });
});

describe("extractions.save", () => {
  it("writes the run as pending rows and links the action to its place", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    const jobId = await saveRun(t, storyId, "run-1");

    const rows = await t.run(async (ctx) => ({
      story: await ctx.db.get("stories", storyId),
      job: await ctx.db.get("jobs", jobId),
      mentions: await ctx.db.query("mentions").collect(),
      places: await ctx.db.query("places").collect(),
      actions: await ctx.db.query("storyActions").collect(),
      topics: await ctx.db.query("storyTopics").collect(),
      jobs: await ctx.db.query("jobs").collect(),
    }));

    expect(rows.story).toMatchObject({ stage: "extracted", latestRunId: "run-1", reviewStatus: "pending" });
    expect(rows.story?.proposedSummary).toContain("Freshwater");
    expect(rows.story?.summary).toBeUndefined();
    expect(rows.job?.status).toBe("done");
    expect(rows.mentions.map((m) => m.reviewStatus)).toEqual(["pending", "pending"]);
    expect(rows.places).toHaveLength(1);
    expect(rows.places[0].mentionId).toBe(rows.mentions[0]._id);
    expect(rows.actions[0].placeMentionId).toBe(rows.mentions[0]._id);
    expect(rows.topics[0]).toMatchObject({ topic: "food-drink", basis: "transcript" });
    expect(rows.jobs.filter((j) => j.kind === "geocode" && j.status === "queued")).toHaveLength(1);
  });

  it("stores the people judge's subject probability so editors can sort passing mentions", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    const person = { ...SAMPLE_RESULT.mentions[1], subjectConfidence: 0.12 };
    await saveRun(t, storyId, "run-1", { ...SAMPLE_RESULT, mentions: [SAMPLE_RESULT.mentions[0], person] });
    const mentions = await t.run((ctx) => ctx.db.query("mentions").collect());
    expect(mentions.find((m) => m.name === "Joe Sasto")?.subjectConfidence).toBe(0.12);
    expect(mentions.find((m) => m.name === "Café Corazón")?.subjectConfidence).toBeUndefined();
  });

  it("leaves rows from an earlier run untouched", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    await saveRun(t, storyId, "run-1");
    await saveRun(t, storyId, "run-2");
    const mentions = await t.run((ctx) => ctx.db.query("mentions").collect());
    expect(mentions.map((m) => m.runId)).toEqual(["run-1", "run-1", "run-2", "run-2"]);
    expect((await t.run((ctx) => ctx.db.get("stories", storyId)))?.latestRunId).toBe("run-2");
  });
});

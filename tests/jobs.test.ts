import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { retryDelayMs } from "../convex/jobs";
import { makeTest, seedStory, type TestConvex } from "./helpers";

async function seedJob(t: TestConvex, attempts = 0, status: "queued" | "running" = "running") {
  const storyId = await seedStory(t);
  const jobId = await t.run((ctx) =>
    ctx.db.insert("jobs", { kind: "extract", storyId, status, attempts, updatedAt: 0 }),
  );
  return { storyId, jobId };
}

describe("retryDelayMs", () => {
  it("waits 1, 4, then 16 minutes", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([60_000, 240_000, 960_000]);
  });
});

describe("jobs.fail", () => {
  it("schedules a retry after the first failure", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t);
    const result = await t.mutation(internal.jobs.fail, { jobId, error: "Bedrock throttled" });
    expect(result).toEqual({ retry: true, delayMs: 60_000 });
    const job = await t.run((ctx) => ctx.db.get("jobs", jobId));
    expect(job).toMatchObject({ status: "retrying", attempts: 1, lastError: "Bedrock throttled" });
  });

  it("hands the story to an editor after the third failure", async () => {
    const t = makeTest();
    const { jobId, storyId } = await seedJob(t, 2);
    const result = await t.mutation(internal.jobs.fail, { jobId, error: "model returned no tool call" });
    expect(result.retry).toBe(false);
    expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({ status: "needs_editor", attempts: 3 });
    expect((await t.run((ctx) => ctx.db.get("stories", storyId)))?.stage).toBe("needs_editor");
  });
});

describe("jobs.markRunning", () => {
  it("marks a queued job running", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t, 0, "queued");
    await t.mutation(internal.jobs.markRunning, { jobId });
    expect((await t.run((ctx) => ctx.db.get("jobs", jobId)))?.status).toBe("running");
  });
});

describe("finished jobs stay finished", () => {
  it("ignores a late failure on a job that is already done", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t);
    await t.run((ctx) => ctx.db.patch("jobs", jobId, { status: "done" }));
    expect(await t.mutation(internal.jobs.fail, { jobId, error: "late throw" })).toEqual({ retry: false, delayMs: 0 });
    expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({ status: "done", attempts: 0 });
  });

  it("does not mark a done job running again", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t);
    await t.run((ctx) => ctx.db.patch("jobs", jobId, { status: "done" }));
    await t.mutation(internal.jobs.markRunning, { jobId });
    expect((await t.run((ctx) => ctx.db.get("jobs", jobId)))?.status).toBe("done");
  });
});

describe("jobs.sweepStale", () => {
  const THIRTY_ONE_MINUTES = 31 * 60_000;

  it("retries a job with no progress for 30 minutes", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t);
    await t.run((ctx) => ctx.db.patch("jobs", jobId, { updatedAt: Date.now() - THIRTY_ONE_MINUTES }));
    await t.mutation(internal.jobs.sweepStale, {});
    expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({ status: "retrying", attempts: 1 });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((s) => s.name)).toContain("aws/extract:run");
  });

  it("leaves a job that made progress recently alone", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t);
    await t.run((ctx) => ctx.db.patch("jobs", jobId, { updatedAt: Date.now() - 60_000 }));
    await t.mutation(internal.jobs.sweepStale, {});
    expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({ status: "running", attempts: 0 });
  });

  it("hands a stuck job's story to an editor on its last attempt", async () => {
    const t = makeTest();
    const { jobId, storyId } = await seedJob(t, 2);
    await t.run((ctx) => ctx.db.patch("jobs", jobId, { updatedAt: Date.now() - THIRTY_ONE_MINUTES }));
    await t.mutation(internal.jobs.sweepStale, {});
    expect((await t.run((ctx) => ctx.db.get("jobs", jobId)))?.status).toBe("needs_editor");
    expect((await t.run((ctx) => ctx.db.get("stories", storyId)))?.stage).toBe("needs_editor");
  });
});

describe("transcribeStep (decision 009)", () => {
  const scheduledFor = async (t: TestConvex) =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).map((s) => s.name);

  it("sends new episodes to Deepgram by default", async () => {
    delete process.env.TRANSCRIBER;
    const t = makeTest();
    const storyId = await seedStory(t);
    await t.mutation(internal.admin.retranscribe, { storyId });
    expect(await scheduledFor(t)).toContain("deepgram:run");
  });

  it("switches back to Amazon Transcribe with TRANSCRIBER=transcribe", async () => {
    process.env.TRANSCRIBER = "transcribe";
    const t = makeTest();
    const storyId = await seedStory(t);
    await t.mutation(internal.admin.retranscribe, { storyId });
    expect(await scheduledFor(t)).toContain("aws/transcribe:start");
    delete process.env.TRANSCRIBER;
  });
});

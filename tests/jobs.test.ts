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

import { v, type Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { StepRef } from "./lib/steps";
import type { jobKindValidator } from "./schema";

export type JobKind = Infer<typeof jobKindValidator>;

export const MAX_ATTEMPTS = 3;

/** 1, 4, then 16 minutes: long enough for AWS throttling to clear. */
export function retryDelayMs(attempt: number): number {
  return 60_000 * 4 ** (attempt - 1);
}

/** Records a queued job and schedules its step to run now. */
export async function enqueue(
  ctx: MutationCtx,
  kind: JobKind,
  storyId: Id<"stories">,
  step: StepRef,
): Promise<Id<"jobs">> {
  const jobId = await ctx.db.insert("jobs", { kind, storyId, status: "queued", attempts: 0, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, step, { jobId, storyId });
  return jobId;
}

export async function markDone(ctx: MutationCtx, jobId: Id<"jobs">): Promise<void> {
  await ctx.db.patch("jobs", jobId, { status: "done", updatedAt: Date.now() });
}

export const markRunning = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await ctx.db.patch("jobs", jobId, { status: "running", updatedAt: Date.now() });
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("jobs"), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    const attempts = job.attempts + 1;
    const retry = attempts < MAX_ATTEMPTS;
    await ctx.db.patch("jobs", jobId, {
      attempts,
      lastError: error.slice(0, 2000),
      status: retry ? "retrying" : "needs_editor",
      updatedAt: Date.now(),
    });
    if (!retry) await ctx.db.patch("stories", job.storyId, { stage: "needs_editor" });
    return { retry, delayMs: retry ? retryDelayMs(attempts) : 0 };
  },
});

import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { StepRef } from "./lib/steps";
import type { jobKindValidator } from "./schema";

export type JobKind = Infer<typeof jobKindValidator>;

export const MAX_ATTEMPTS = 3;
/** A live job touches updatedAt at least every minute (Transcribe polls) and waits at most 16 minutes between retries. */
const STALE_AFTER_MS = 30 * 60_000;
const SWEEP_BATCH = 100;

/** 1, 4, then 16 minutes: long enough for AWS throttling to clear. */
export function retryDelayMs(attempt: number): number {
  return 60_000 * 4 ** (attempt - 1);
}

/** Decision 009: Deepgram Nova-3 transcribes by default; TRANSCRIBER=transcribe switches back to Amazon Transcribe. */
export function transcribeStep(): StepRef {
  return process.env.TRANSCRIBER === "transcribe" ? internal.aws.transcribe.start : internal.deepgram.run;
}

function stepFor(kind: JobKind): StepRef {
  switch (kind) {
    case "transcribe":
      return transcribeStep();
    case "article":
      return internal.articles.run;
    case "extract":
      return internal.aws.extract.run;
    case "geocode":
      return internal.aws.geocode.run;
  }
}

const isFinished = (job: Doc<"jobs">) => job.status === "done" || job.status === "needs_editor";

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

/** Counts a failed attempt. A finished job ignores late failures, so a done step never re-runs. */
async function recordFailure(ctx: MutationCtx, job: Doc<"jobs">, error: string) {
  if (isFinished(job)) return { retry: false, delayMs: 0 };
  const attempts = job.attempts + 1;
  const retry = attempts < MAX_ATTEMPTS;
  await ctx.db.patch("jobs", job._id, {
    attempts,
    lastError: error.slice(0, 2000),
    status: retry ? "retrying" : "needs_editor",
    updatedAt: Date.now(),
  });
  if (!retry) await ctx.db.patch("stories", job.storyId, { stage: "needs_editor" });
  return { retry, delayMs: retry ? retryDelayMs(attempts) : 0 };
}

export const markRunning = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job || isFinished(job)) return;
    await ctx.db.patch("jobs", jobId, { status: "running", updatedAt: Date.now() });
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("jobs"), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return recordFailure(ctx, job, error);
  },
});

export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    for (const status of ["queued", "running", "retrying"] as const) {
      const stale = await ctx.db
        .query("jobs")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status).lt("updatedAt", cutoff))
        .take(SWEEP_BATCH);
      for (const job of stale) {
        const { retry, delayMs } = await recordFailure(ctx, job, `no progress for 30 minutes (was ${status})`);
        if (retry) await ctx.scheduler.runAfter(delayMs, stepFor(job.kind), { jobId: job._id, storyId: job.storyId });
      }
    }
  },
});

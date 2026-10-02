import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

export const stepArgs = { jobId: v.id("jobs"), storyId: v.id("stories") };
export type StepArgs = { jobId: Id<"jobs">; storyId: Id<"stories"> };
export type StepRef = FunctionReference<"action", "internal", StepArgs>;

/**
 * Runs one pipeline step. If `work` throws, the job records the error and, while
 * attempts remain, `retryWith` is scheduled again after the backoff delay.
 * `work` is responsible for marking the job done (inside the mutation that saves its output).
 */
export async function runStep(
  ctx: ActionCtx,
  args: StepArgs,
  retryWith: StepRef,
  work: () => Promise<void>,
): Promise<void> {
  await ctx.runMutation(internal.jobs.markRunning, { jobId: args.jobId });
  try {
    await work();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backstory] job ${args.jobId} failed: ${message}`);
    const { retry, delayMs } = await ctx.runMutation(internal.jobs.fail, { jobId: args.jobId, error: message });
    if (retry) await ctx.scheduler.runAfter(delayMs, retryWith, args);
  }
}

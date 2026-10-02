import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { approveRun } from "./lib/approveRun";
import { requireReviewer } from "./lib/reviewAuth";
import { reviewStatusValidator } from "./schema";

const MAX_SUMMARY = 1500; // same cap as the extraction schema
const MAX_NAME = 80;
const MAX_NEIGHBORHOOD = 60;

const itemValidator = v.union(
  v.object({ table: v.literal("mentions"), id: v.id("mentions") }),
  v.object({ table: v.literal("places"), id: v.id("places") }),
  v.object({ table: v.literal("storyTopics"), id: v.id("storyTopics") }),
  v.object({ table: v.literal("storyActions"), id: v.id("storyActions") }),
);

/** Only the run under review or the run on the air can change; older runs are history. */
async function assertLiveRun(ctx: MutationCtx, row: { storyId: Id<"stories">; runId: string } | null) {
  if (!row) throw new ConvexError({ code: "not_found" });
  const story = await ctx.db.get("stories", row.storyId);
  if (!story || (row.runId !== story.latestRunId && row.runId !== story.approvedRunId)) throw new ConvexError({ code: "stale_run" });
}

export const decideItem = mutation({
  args: { item: itemValidator, status: reviewStatusValidator },
  handler: async (ctx, { item, status }) => {
    await requireReviewer(ctx);
    switch (item.table) {
      case "mentions":
        await assertLiveRun(ctx, await ctx.db.get("mentions", item.id));
        return ctx.db.patch("mentions", item.id, { reviewStatus: status });
      case "places":
        await assertLiveRun(ctx, await ctx.db.get("places", item.id));
        return ctx.db.patch("places", item.id, { reviewStatus: status });
      case "storyTopics":
        await assertLiveRun(ctx, await ctx.db.get("storyTopics", item.id));
        return ctx.db.patch("storyTopics", item.id, { reviewStatus: status });
      case "storyActions":
        await assertLiveRun(ctx, await ctx.db.get("storyActions", item.id));
        return ctx.db.patch("storyActions", item.id, { reviewStatus: status });
    }
  },
});

export const approveEpisode = mutation({
  args: { storyId: v.id("stories"), runId: v.string(), summary: v.string() },
  handler: async (ctx, { storyId, runId, summary }) => {
    const email = await requireReviewer(ctx);
    const trimmed = summary.trim();
    if (!trimmed || trimmed.length > MAX_SUMMARY) throw new ConvexError({ code: "invalid_summary" });
    const story = await ctx.db.get("stories", storyId);
    if (!story) throw new ConvexError({ code: "not_found" });
    if (story.latestRunId !== runId) throw new ConvexError({ code: "stale_run" });
    // Places get their map pins after extraction; approving before then would publish pins nobody saw.
    if (story.stage === "extracted") throw new ConvexError({ code: "not_ready" });
    await approveRun(ctx, storyId, runId);
    await ctx.db.patch("stories", storyId, {
      summary: trimmed, approvedRunId: runId, reviewStatus: "approved", approvedBy: email, approvedAt: Date.now(),
    });
    return { approvedRunId: runId };
  },
});

export const setSpeakerName = mutation({
  args: { storyId: v.id("stories"), label: v.string(), name: v.string() },
  handler: async (ctx, { storyId, label, name }) => {
    await requireReviewer(ctx);
    const trimmed = name.trim();
    if (trimmed.length > MAX_NAME) throw new ConvexError({ code: "invalid_name" });
    const existing = (await ctx.db.query("speakerNames").withIndex("by_storyId", (q) => q.eq("storyId", storyId)).take(50))
      .find((row) => row.label === label);
    if (!trimmed) {
      if (existing) await ctx.db.delete("speakerNames", existing._id);
      return;
    }
    if (existing) await ctx.db.patch("speakerNames", existing._id, { name: trimmed, source: "editor", confidence: undefined });
    else await ctx.db.insert("speakerNames", { storyId, label, name: trimmed, source: "editor" });
  },
});

export const setPlaceNeighborhood = mutation({
  args: { placeId: v.id("places"), neighborhood: v.union(v.string(), v.null()) },
  handler: async (ctx, { placeId, neighborhood }) => {
    await requireReviewer(ctx);
    const trimmed = neighborhood?.trim() || undefined;
    if (trimmed && trimmed.length > MAX_NEIGHBORHOOD) throw new ConvexError({ code: "invalid_neighborhood" });
    await assertLiveRun(ctx, await ctx.db.get("places", placeId));
    await ctx.db.patch("places", placeId, { neighborhood: trimmed });
  },
});

export const setDoNotUse = mutation({
  args: {
    target: v.union(v.object({ table: v.literal("stories"), id: v.id("stories") }), v.object({ table: v.literal("mentions"), id: v.id("mentions") })),
    doNotUse: v.boolean(),
  },
  handler: async (ctx, { target, doNotUse }) => {
    await requireReviewer(ctx);
    if (target.table === "stories") {
      if (!(await ctx.db.get("stories", target.id))) throw new ConvexError({ code: "not_found" });
      return ctx.db.patch("stories", target.id, { doNotUse });
    }
    await assertLiveRun(ctx, await ctx.db.get("mentions", target.id));
    return ctx.db.patch("mentions", target.id, { doNotUse });
  },
});

import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { approveRun } from "./lib/approveRun";
import { normalizeForMatch } from "./lib/evidence";
import { requireReviewer } from "./lib/reviewAuth";
import { refreshStorySearch } from "./lib/storySearch";
import { placeCategoryValidator, removeReasonValidator, reviewStatusValidator } from "./schema";

const MAX_SUMMARY = 1500; // same cap as the extraction schema
const MAX_NAME = 80;
const MAX_NEIGHBORHOOD = 60;
const MAX_MENTION_NAME = 120;
const LOCATABLE = new Set(["place", "organization", "event"]);

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
  args: { item: itemValidator, status: reviewStatusValidator, reason: v.optional(removeReasonValidator) },
  handler: async (ctx, { item, status, reason }) => {
    await requireReviewer(ctx);
    const decision = { reviewStatus: status, removeReason: status === "rejected" ? (reason ?? "wrong") : undefined };
    let row: { storyId: Id<"stories">; runId: string } | null;
    switch (item.table) {
      case "mentions":
        row = await ctx.db.get("mentions", item.id);
        await assertLiveRun(ctx, row);
        await ctx.db.patch("mentions", item.id, decision);
        break;
      case "places":
        row = await ctx.db.get("places", item.id);
        await assertLiveRun(ctx, row);
        await ctx.db.patch("places", item.id, decision);
        break;
      case "storyTopics":
        row = await ctx.db.get("storyTopics", item.id);
        await assertLiveRun(ctx, row);
        await ctx.db.patch("storyTopics", item.id, decision);
        break;
      case "storyActions":
        row = await ctx.db.get("storyActions", item.id);
        await assertLiveRun(ctx, row);
        await ctx.db.patch("storyActions", item.id, decision);
        break;
    }
    await refreshStorySearch(ctx, row!.storyId);
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
    await refreshStorySearch(ctx, storyId);
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
    const mention = await ctx.db.get("mentions", target.id);
    await assertLiveRun(ctx, mention);
    await ctx.db.patch("mentions", target.id, { doNotUse });
    await refreshStorySearch(ctx, mention!.storyId);
  },
});

/**
 * Saves the pin an editor got by typing an address (aws/pinLocation.run checks the reviewer, then calls this).
 * A person chose it, so it is approved at full confidence. Corrects an existing place, or makes a mention a place.
 */
export const savePin = internalMutation({
  args: { mentionId: v.id("mentions"), lat: v.number(), lng: v.number(), label: v.string(), category: placeCategoryValidator },
  handler: async (ctx, { mentionId, lat, lng, label, category }) => {
    const mention = await ctx.db.get("mentions", mentionId);
    await assertLiveRun(ctx, mention);
    // A person's or a dish's location is never published; only places people can visit get pins.
    if (!LOCATABLE.has(mention!.entityType)) throw new ConvexError({ code: "not_locatable" });
    const pin = { lat, lng, geocodeLabel: label, geocodeConfidence: 1, category };
    const existing = await ctx.db.query("places").withIndex("by_mentionId", (q) => q.eq("mentionId", mentionId)).unique();
    // Fixing the pin of a removed place keeps it removed; it must never put the place back on Alexa.
    if (existing) await ctx.db.patch("places", existing._id, existing.reviewStatus === "rejected" ? pin : { ...pin, reviewStatus: "approved" });
    else await ctx.db.insert("places", { storyId: mention!.storyId, runId: mention!.runId, mentionId, name: mention!.name, ...pin, reviewStatus: "approved" });
    await refreshStorySearch(ctx, mention!.storyId);
  },
});

/** Fix a misheard spelling ("Luke Zaum" → "Luke Zahm"). The editor's spelling wins over the map's, and becomes searchable. */
export const renameMention = mutation({
  args: { mentionId: v.id("mentions"), name: v.string() },
  handler: async (ctx, { mentionId, name }) => {
    await requireReviewer(ctx);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_MENTION_NAME) throw new ConvexError({ code: "invalid_name" });
    const mention = await ctx.db.get("mentions", mentionId);
    await assertLiveRun(ctx, mention);
    await ctx.db.patch("mentions", mentionId, {
      name: trimmed,
      searchText: normalizeForMatch(`${trimmed} ${mention!.relatedPlace ?? ""} ${mention!.quote}`),
    });
    const place = await ctx.db.query("places").withIndex("by_mentionId", (q) => q.eq("mentionId", mentionId)).unique();
    if (place) await ctx.db.patch("places", place._id, { name: trimmed, officialName: trimmed });
    await refreshStorySearch(ctx, mention!.storyId);
  },
});

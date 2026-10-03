import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Literal lists mirror convex/lib/shows.ts and convex/lib/taxonomy.ts.
// tests/schema.test.ts fails if they drift apart.
export const reviewStatusValidator = v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"));
/** Why an editor removed an item: the AI got it wrong, it is true but shouldn't be on Alexa, or it's too minor to matter. */
export const removeReasonValidator = v.union(v.literal("wrong"), v.literal("sensitive"), v.literal("minor"));
export const entityTypeValidator = v.union(
  v.literal("person"), v.literal("organization"), v.literal("place"), v.literal("event"), v.literal("dish"),
);
export const placeCategoryValidator = v.union(
  v.literal("restaurant"), v.literal("bar"), v.literal("venue"), v.literal("park"), v.literal("organization"),
);
export const actionKindValidator = v.union(
  v.literal("visit"), v.literal("reserve"), v.literal("attend"), v.literal("support"), v.literal("remember"),
);
export const topicValidator = v.union(
  v.literal("music"), v.literal("comedy"), v.literal("sports"), v.literal("festival"), v.literal("family"),
  v.literal("food-drink"), v.literal("arts"), v.literal("community"), v.literal("other"),
  v.literal("civic-life"), v.literal("history"), v.literal("education"), v.literal("business"),
);
export const stageValidator = v.union(
  v.literal("ingested"), v.literal("transcribing"), v.literal("transcribed"),
  v.literal("extracted"), v.literal("geocoded"), v.literal("needs_editor"),
);
export const jobKindValidator = v.union(v.literal("transcribe"), v.literal("extract"), v.literal("geocode"));
export const jobStatusValidator = v.union(
  v.literal("queued"), v.literal("running"), v.literal("retrying"), v.literal("done"), v.literal("needs_editor"),
);

const quoteFields = { quote: v.string(), startMs: v.number() };

export default defineSchema({
  stories: defineTable({
    cdsId: v.string(),
    showSlug: v.string(),
    contentType: v.literal("episode"), // Plan 4 widens this for premieres, picks and sessions
    title: v.string(),
    teaserText: v.string(), // CDS show notes: spelling hints for the model, never evidence
    publishedAt: v.number(),
    audioUrl: v.string(),
    durationSec: v.number(),
    permalink: v.optional(v.string()),
    imageUrl: v.optional(v.string()), // show artwork (CDS series image-square)
    searchText: v.optional(v.string()), // published title + summary + topics + places (lib/storySearch)
    stage: stageValidator,
    proposedSummary: v.optional(v.string()), // from the latest extraction run
    summary: v.optional(v.string()), // the approved summary listeners hear
    latestRunId: v.optional(v.string()),
    approvedRunId: v.optional(v.string()),
    reviewStatus: reviewStatusValidator,
    doNotUse: v.boolean(),
    approvedBy: v.optional(v.string()), // verified email of the editor who approved the live run
    approvedAt: v.optional(v.number()),
    allowDetailedAnswers: v.optional(v.boolean()), // transcript answers on Alexa; unset → the show's default (lib/shows)
  })
    .index("by_cdsId", ["cdsId"])
    .index("by_showSlug_and_publishedAt", ["showSlug", "publishedAt"])
    .index("by_reviewStatus_and_publishedAt", ["reviewStatus", "publishedAt"])
    .searchIndex("search_story", { searchField: "searchText", filterFields: ["reviewStatus", "doNotUse", "showSlug"] }),

  sources: defineTable({
    storyId: v.id("stories"),
    kind: v.union(v.literal("cds_document"), v.literal("transcript")),
    ref: v.string(),
    fetchedAt: v.number(),
  }).index("by_storyId", ["storyId"]),

  transcriptSegments: defineTable({
    storyId: v.id("stories"),
    idx: v.number(),
    speaker: v.string(), // Transcribe label (spk_0); editors map to names in Plan 2
    startMs: v.number(),
    endMs: v.number(),
    text: v.string(),
  })
    .index("by_storyId_and_idx", ["storyId", "idx"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["storyId"] }),

  mentions: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    entityType: entityTypeValidator,
    name: v.string(),
    ...quoteFields,
    speaker: v.string(),
    relatedPlace: v.optional(v.string()), // dish → the restaurant that serves it
    originalName: v.optional(v.string()), // the transcript's spelling, kept when an editor renames (askStory's guard needs it)
    subjectConfidence: v.optional(v.number()), // people only: Jev's probability they're a real subject, not a passing mention
    reviewStatus: reviewStatusValidator,
    removeReason: v.optional(removeReasonValidator),
    doNotUse: v.boolean(),
    searchText: v.string(), // normalized name + related place + quote
  })
    .index("by_storyId_and_runId", ["storyId", "runId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["reviewStatus"] }),

  places: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    mentionId: v.id("mentions"),
    name: v.string(),
    category: placeCategoryValidator,
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeLabel: v.optional(v.string()),
    officialName: v.optional(v.string()), // the business's own spelling from the map match ("Immy's", not Transcribe's "Emmy's")
    geocodeConfidence: v.optional(v.number()), // 0–1; unset until the geocode step runs
    neighborhood: v.optional(v.string()), // set by editors in Plan 2
    reservationUrl: v.optional(v.string()), // editor-set booking page (OpenTable, Resy, Tock, SevenRooms); Radio Commons shows Reserve
    fieldGuideVenueId: v.optional(v.string()), // matched in Plan 2
    lastConfirmedAt: v.optional(v.number()), // restaurant freshness, Plan 5
    reviewStatus: reviewStatusValidator,
    removeReason: v.optional(removeReasonValidator),
  })
    .index("by_storyId_and_runId", ["storyId", "runId"])
    .index("by_mentionId", ["mentionId"]),

  storyTopics: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    topic: topicValidator,
    confidence: v.number(),
    ...quoteFields,
    basis: v.literal("transcript"),
    reviewStatus: reviewStatusValidator,
    removeReason: v.optional(removeReasonValidator),
  }).index("by_storyId_and_runId", ["storyId", "runId"]),

  storyActions: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    kind: actionKindValidator,
    label: v.string(),
    placeMentionId: v.optional(v.id("mentions")),
    ...quoteFields,
    reviewStatus: reviewStatusValidator,
    removeReason: v.optional(removeReasonValidator),
  }).index("by_storyId_and_runId", ["storyId", "runId"]),

  speakerNames: defineTable({
    storyId: v.id("stories"),
    label: v.string(), // Transcribe's speaker label, e.g. spk_1
    name: v.string(),
    confidence: v.optional(v.number()), // Jev's confidence for suggestions
    source: v.union(v.literal("suggested"), v.literal("editor")),
  }).index("by_storyId", ["storyId"]),

  jobs: defineTable({
    kind: jobKindValidator,
    storyId: v.id("stories"),
    status: jobStatusValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    externalId: v.optional(v.string()), // Transcribe job name
    updatedAt: v.number(),
  })
    .index("by_storyId", ["storyId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
});

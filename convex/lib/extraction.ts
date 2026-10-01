import { z } from "zod";
import { findEvidence, MIN_QUOTE_WORDS, normalizeForMatch, type EvidenceMatch, type Segment, type TranscriptIndex } from "./evidence";
import { ACTION_KINDS, ENTITY_TYPES, PLACE_CATEGORIES, type ShowProfile } from "./shows";
import { TOPIC_VALUES } from "./taxonomy";

export const MAX_TOPICS = 3;
export const MAX_MENTIONS = 40;
export const MAX_ACTIONS = 10;

const FILLER_WORDS = new Set(["the", "a", "an", "and", "of"]);

const looksLikeWebsite = (name: string) => /https?:|www\.|\/|\.(org|com|net|edu|gov|fm)\b/i.test(name);

/** True when at least one word of the name appears in the quote, so the quote is about it. */
function quoteNamesIt(name: string, quote: string): boolean {
  const quoteWords = new Set(normalizeForMatch(quote).split(" "));
  return normalizeForMatch(name).split(" ").some((word) => word && !FILLER_WORDS.has(word) && quoteWords.has(word));
}

export const extractionSchema = z.object({
  summary: z.string().min(1).max(600),
  mentions: z
    .array(
      z.object({
        entityType: z.enum(ENTITY_TYPES),
        name: z.string().min(1),
        quote: z.string(),
        placeCategory: z.enum(PLACE_CATEGORIES).nullable(),
        relatedPlace: z.string().nullable(),
      }),
    )
    .max(MAX_MENTIONS),
  topics: z
    .array(z.object({ topic: z.enum(TOPIC_VALUES), confidence: z.number().min(0).max(1), quote: z.string() }))
    .max(MAX_TOPICS),
  actions: z
    .array(
      z.object({ kind: z.enum(ACTION_KINDS), label: z.string().min(1), placeName: z.string().nullable(), quote: z.string() }),
    )
    .max(MAX_ACTIONS),
});

/**
 * Keeps the first items up to each cap. A model that lists 45 mentions should lose the last 5,
 * not the whole episode (at temperature 0 a retry would overflow the same way).
 */
export function trimToCaps(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const cap = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : value);
  const output = raw as Record<string, unknown>;
  return {
    ...output,
    mentions: cap(output.mentions, MAX_MENTIONS),
    topics: cap(output.topics, MAX_TOPICS),
    actions: cap(output.actions, MAX_ACTIONS),
  };
}

export type Extraction = z.infer<typeof extractionSchema>;

/** The tool input schema sent to Bedrock, which rejects a top-level $schema key. */
export function extractionJsonSchema(): Record<string, unknown> {
  const { $schema: _unused, ...schema } = z.toJSONSchema(extractionSchema) as Record<string, unknown>;
  return schema;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function buildExtractionPrompt(input: {
  profile: ShowProfile;
  title: string;
  teaserText: string;
  publishedAt: number;
  segments: Segment[];
}): string {
  const transcript = input.segments
    .map((segment) => `[${segment.speaker} ${formatTimestamp(segment.startMs)}] ${segment.text}`)
    .join("\n");
  return [
    `You extract verified story data from one episode of the Radio Milwaukee podcast "${input.profile.name}".`,
    `Episode: "${input.title}", published ${new Date(input.publishedAt).toISOString().slice(0, 10)}.`,
    "",
    "Rules:",
    `- Every quote must be copied word for word from the TRANSCRIPT: at least ${MIN_QUOTE_WORDS} consecutive words, no paraphrasing. Anything whose quote is not in the transcript is discarded automatically.`,
    "- Copy each quote exactly as the TRANSCRIPT spells it, even when a name is misspelled there; put the correct spelling (from SHOW NOTES if needed) in name.",
    "- SHOW NOTES are for spelling names correctly only. Never quote them.",
    `- Never record a website, a URL, or this show itself ("${input.profile.name}") as a mention.`,
    "- A mention's quote must contain its name (or part of it), so an editor can see what it refers to.",
    `- Allowed mention types: ${input.profile.entityTypes.join(", ")}.`,
    "- Places are public businesses, venues, parks and organizations only, never a private home or home address. Every place needs a placeCategory; use null for anything that is not a place.",
    "- A dish must name the place that serves it in relatedPlace; otherwise leave the dish out.",
    `- Up to ${MAX_TOPICS} topics, only from: ${TOPIC_VALUES.join(", ")}. Each needs a supporting quote.`,
    `- Actions a listener could take, only of kinds: ${input.profile.actionKinds.join(", ")}. Set placeName to the place exactly as named in mentions when the action has one.`,
    '- Action label: a short phrase saying what to do and where, for example "Visit Café Corazón in Riverwest".',
    "- summary: two sentences describing the episode. It is labeled as a summary, so never present opinions as facts or put words in anyone's mouth.",
    `- ${input.profile.extractionNotes}`,
    "",
    "SHOW NOTES:",
    input.teaserText,
    "",
    "TRANSCRIPT:",
    transcript,
  ].join("\n");
}

export interface Dropped {
  kind: "mention" | "topic" | "action";
  name: string;
  reason: string;
}

type Checked<T> = T & EvidenceMatch;

export interface CheckedExtraction {
  summary: string;
  mentions: Array<Checked<Extraction["mentions"][number]>>;
  topics: Array<Checked<Extraction["topics"][number]>>;
  actions: Array<Checked<Extraction["actions"][number]>>;
  dropped: Dropped[];
}

/** Drops anything the show profile doesn't allow or whose quote isn't in the transcript. */
export function applyEvidence(extraction: Extraction, index: TranscriptIndex, profile: ShowProfile): CheckedExtraction {
  const dropped: Dropped[] = [];
  const drop = (kind: Dropped["kind"], name: string, reason: string): [] => {
    dropped.push({ kind, name, reason });
    return [];
  };
  const withEvidence = <T extends { quote: string }>(kind: Dropped["kind"], name: string, item: T): Array<Checked<T>> => {
    const match = findEvidence(index, item.quote);
    return match ? [{ ...item, ...match }] : drop(kind, name, "quote not found in transcript");
  };

  const mentions = extraction.mentions.flatMap((mention) => {
    if (looksLikeWebsite(mention.name)) return drop("mention", mention.name, "a website, not a story subject");
    if (normalizeForMatch(mention.name) === normalizeForMatch(profile.name)) {
      return drop("mention", mention.name, "the show itself, not a story subject");
    }
    if (!profile.entityTypes.includes(mention.entityType)) {
      return drop("mention", mention.name, `entity type ${mention.entityType} not in show profile`);
    }
    if (mention.entityType === "place" && !mention.placeCategory) return drop("mention", mention.name, "place without a category");
    if (mention.entityType === "dish" && !mention.relatedPlace) {
      return drop("mention", mention.name, "dish without the place that serves it");
    }
    if (!quoteNamesIt(mention.name, mention.quote)) return drop("mention", mention.name, "quote does not name it");
    return withEvidence("mention", mention.name, mention);
  });

  const topics = extraction.topics.flatMap((topic) => withEvidence("topic", topic.topic, topic));

  const keptPlaces = new Set(mentions.filter((m) => m.entityType === "place").map((m) => normalizeForMatch(m.name)));
  const actions = extraction.actions.flatMap((action) => {
    if (!profile.actionKinds.includes(action.kind)) {
      return drop("action", action.label, `action kind ${action.kind} not in show profile`);
    }
    const placeName = action.placeName && keptPlaces.has(normalizeForMatch(action.placeName)) ? action.placeName : null;
    return withEvidence("action", action.label, { ...action, placeName });
  });

  return { summary: extraction.summary, mentions, topics, actions, dropped };
}

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { normalizeForMatch } from "./evidence";
import { relevantEnough } from "./storySearch";
import { SHOW_PROFILES } from "./shows";

const MAX_PASSAGE = 300;

export function allowsDetailedAnswers(story: { allowDetailedAnswers?: boolean }, profile: { detailedAnswersDefault: boolean }): boolean {
  return story.allowDetailedAnswers ?? profile.detailedAnswersDefault;
}

/**
 * Names whose passages are never quoted, from the published run: every person an editor removed (for any reason,
 * misheard names included), anything kept off Alexa, and any do-not-use mention.
 */
export function blockedNames(
  mentions: { name: string; originalName?: string; entityType: string; reviewStatus: string; removeReason?: string; doNotUse: boolean }[],
  places: { name: string; officialName?: string; removeReason?: string }[],
): string[] {
  const blockedMentions = mentions.filter((m) => (m.entityType === "person" && m.reviewStatus === "rejected") || m.removeReason === "sensitive" || m.doNotUse);
  const full = [
    ...blockedMentions.flatMap((m) => [m.name, m.originalName ?? ""]),
    ...places.filter((p) => p.removeReason === "sensitive").flatMap((p) => [p.name, p.officialName ?? ""]),
  ].map(normalizeForMatch);
  // People are called by first or last name alone once introduced ("Maria told me…"), so each part of a blocked
  // person's name blocks too. Over-blocking only hides an answer; under-blocking says a private name aloud.
  // ponytail: word-level only; nicknames and misspellings ("Terrence") still pass — UM stays off by default for that reason.
  const parts = blockedMentions
    .filter((m) => m.entityType === "person")
    .flatMap((m) => [m.name, m.originalName ?? ""])
    .flatMap((name) => normalizeForMatch(name).split(" "))
    .filter((word) => word.length >= 3 && !NAME_STOP.has(word));
  return [...new Set([...full, ...parts].filter(Boolean))];
}

/** Whole-word match on normalized text. normalizeForMatch drops apostrophes, so "Sasto's" arrives as "sastos". */
export function mentionsBlocked(text: string, blocked: string[]): boolean {
  const words = ` ${normalizeForMatch(text)} `;
  return blocked.some((name) => words.includes(` ${name} `) || words.includes(` ${name}s `));
}

export function trimPassage(text: string, max = MAX_PASSAGE): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
}

const NAME_STOP = new Set([
  "the", "and", "mrs", "van", "von", "del", "der", "los", "las",
  ...Object.values(SHOW_PROFILES).flatMap((show) => show.hosts.flatMap((host) => normalizeForMatch(host).split(" "))),
]);

// "What did Ann say about the stromboli?" → "stromboli": the question words and hosts are how a listener asks, not what's in the passage.
const ASKING_WORDS = new Set([
  "what", "did", "does", "do", "they", "say", "says", "said", "talk", "talked", "talking", "mention", "mentioned", "tell", "told",
  "which", "who", "when", "where", "how", "there", "their", "he", "she", "we", "you", "me", "us", "host", "hosts", "part",
  ...Object.values(SHOW_PROFILES).flatMap((show) => show.hosts.flatMap((host) => normalizeForMatch(host).split(" "))),
]);

export function detailWords(question: string): string {
  return normalizeForMatch(question).split(" ").filter((word) => word && !ASKING_WORDS.has(word)).join(" ");
}

const MAX_ROWS_PER_RUN = 200;
const SHORT_PASSAGE = 120; // shorter than this, a quote is a fragment ("Il Ponte. Il"): add the next line

export interface Passage { text: string; startMs: number; speaker: string | null }
type Guard = { blocked: string[]; blockedSpeakers: Set<string>; confirmed: Map<string, string> };

/** Is this story on the air and does it allow transcript quotes? */
export function quotable(story: Doc<"stories"> | null): story is Doc<"stories"> {
  return !!story && !!story.approvedRunId && story.reviewStatus === "approved" && !story.doNotUse;
}

/** What may never be quoted from this episode: blocked names (published run and any re-processed run under review), and speakers they belong to. */
export async function storyGuard(ctx: QueryCtx, story: Doc<"stories">): Promise<Guard> {
  const runs = [...new Set([story.approvedRunId!, story.latestRunId ?? story.approvedRunId!])];
  const mentions = [];
  const places = [];
  for (const run of runs) {
    mentions.push(...(await ctx.db.query("mentions").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", story._id).eq("runId", run)).take(MAX_ROWS_PER_RUN)));
    places.push(...(await ctx.db.query("places").withIndex("by_storyId_and_runId", (q) => q.eq("storyId", story._id).eq("runId", run)).take(MAX_ROWS_PER_RUN)));
  }
  const blocked = blockedNames(mentions, places);
  const names = await ctx.db.query("speakerNames").withIndex("by_storyId", (q) => q.eq("storyId", story._id)).take(MAX_ROWS_PER_RUN);
  return {
    blocked,
    // Any name on a speaker, suggested or confirmed, can block their words; only a confirmed one is ever shown.
    blockedSpeakers: new Set(names.filter((n) => mentionsBlocked(n.name, blocked)).map((n) => n.label)),
    confirmed: new Map(names.filter((n) => n.source === "editor").map((n) => [n.label, n.name])),
  };
}

/**
 * Turns one matching transcript line into a quotable passage: a fragment gets the following line(s) added, and the
 * whole passage (every line, every speaker) must clear the guard, or it is dropped.
 */
export async function passageAt(ctx: QueryCtx, seg: Doc<"transcriptSegments">, guard: Guard): Promise<Passage | null> {
  const lines = [seg];
  if (seg.text.length < SHORT_PASSAGE) {
    const next = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_storyId_and_idx", (q) => q.eq("storyId", seg.storyId).gt("idx", seg.idx).lte("idx", seg.idx + 2))
      .take(2);
    for (const line of next) {
      // Only the same speaker's next words: a quote must never run into someone else's.
      if (line.speaker !== seg.speaker || lines.map((l) => l.text).join(" ").length >= SHORT_PASSAGE) break;
      lines.push(line);
    }
  }
  if (lines.some((l) => mentionsBlocked(l.text, guard.blocked) || guard.blockedSpeakers.has(l.speaker))) return null;
  const speakers = new Set(lines.map((l) => l.speaker));
  return {
    text: trimPassage(lines.map((l) => l.text).join(" ")),
    startMs: seg.startMs,
    speaker: speakers.size === 1 ? (guard.confirmed.get(seg.speaker) ?? null) : null,
  };
}

/** Up to `limit` guarded passages from one episode that match the listener's words, in episode order. */
export async function findPassages(ctx: QueryCtx, story: Doc<"stories">, wanted: string, limit: number): Promise<Passage[]> {
  const guard = await storyGuard(ctx, story);
  const hits = await ctx.db
    .query("transcriptSegments")
    .withSearchIndex("search_text", (q) => q.search("text", wanted).eq("storyId", story._id))
    .take(20);
  const passages: Passage[] = [];
  for (const seg of hits) {
    if (passages.length >= limit) break;
    if (!relevantEnough(wanted, normalizeForMatch(seg.text))) continue;
    const passage = await passageAt(ctx, seg, guard);
    if (passage) passages.push(passage);
  }
  return passages.sort((a, b) => a.startMs - b.startMs);
}

/** "18:42", or "1:02:05" past an hour. */
export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const [h, m, sec] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** The listener's words, minus how they asked, capped at Convex full-text search's 16 terms. */
export function searchTerms(question: string): string {
  return detailWords(question).split(" ").slice(0, 16).join(" ");
}

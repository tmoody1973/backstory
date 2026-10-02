export interface Segment {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface EvidenceMatch {
  startMs: number;
  speaker: string;
}

/** Shorter quotes ("Bay View") match by accident and prove nothing. */
export const MIN_QUOTE_WORDS = 4;

/** Lowercase, strip accents, drop apostrophes, turn every other non-alphanumeric run into one space. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface TranscriptIndex {
  text: string;
  starts: Array<{ offset: number; segment: Segment }>;
}

/** One normalized string for the whole transcript, plus where each segment begins in it. */
export function buildTranscriptIndex(segments: Segment[]): TranscriptIndex {
  let text = "";
  const starts: TranscriptIndex["starts"] = [];
  for (const segment of segments) {
    const normalized = normalizeForMatch(segment.text);
    if (!normalized) continue;
    if (text) text += " ";
    starts.push({ offset: text.length, segment });
    text += normalized;
  }
  return { text, starts };
}

/** Where the quote starts in the transcript, or null if it isn't there word for word. */
export function findEvidence(index: TranscriptIndex, quote: string): EvidenceMatch | null {
  const normalized = normalizeForMatch(quote);
  if (normalized.split(" ").length < MIN_QUOTE_WORDS) return null;
  // Padding both sides with spaces forces whole-word matches.
  const offset = ` ${index.text} `.indexOf(` ${normalized} `);
  if (offset === -1) return null;
  let hit = index.starts[0];
  for (const start of index.starts) {
    if (start.offset > offset) break;
    hit = start;
  }
  return { startMs: hit.segment.startMs, speaker: hit.segment.speaker };
}

/** True when two words differ by one inserted, deleted or changed letter ("emmys" / "immys", "tariq" / "tarik"). */
export function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

import type { Segment } from "./evidence";
import { normalizeForMatch } from "./evidence";
import type { ShowProfile } from "./shows";

export const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
export const DEEPGRAM_MODEL = "nova-3";
/** Deepgram allows 500 tokens of keyterms per request; ~1.3 tokens per word leaves headroom. */
const KEYTERM_WORD_BUDGET = 300;

export interface Correction {
  heard: string;
  correct: string;
}

// Capitalized only because they start a sentence ("Chefs Joe Sasto and…"): never part of a name.
const LEAD_INS = new Set(["the", "a", "an", "we", "our", "their", "this", "these", "and", "with", "chef", "chefs", "owner", "owners", "host", "hosts"]);

/** Capitalized runs of 2–4 words in show notes: "Café Corazón", "Joe Sasto", "Bay View Neighborhood Association". */
export function showNoteNames(showNotes: string): string[] {
  const pattern = /\b\p{Lu}[\p{L}'’&.-]*(?:\s+(?:&|of|de|la|\p{Lu}[\p{L}'’&.-]*)){1,3}/gu;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of showNotes.match(pattern) ?? []) {
    const words = raw.trim().replace(/[.,;:!?]+$/, "").split(/\s+/);
    while (words.length > 1 && LEAD_INS.has(words[0].toLowerCase())) words.shift();
    if (words.length < 2) continue;
    const name = words.join(" ");
    const key = normalizeForMatch(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/** Hints for Deepgram: hosts first, then names we know are tricky, then this episode's show-notes names. */
export function deepgramKeyterms(profile: ShowProfile, showNotes: string, knownNames: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  let words = 0;
  for (const term of [...profile.hosts, ...knownNames, ...showNoteNames(showNotes)]) {
    const key = normalizeForMatch(term);
    const count = term.split(/\s+/).length;
    if (!key || seen.has(key)) continue;
    if (words + count > KEYTERM_WORD_BUDGET) break;
    seen.add(key);
    terms.push(term);
    words += count;
  }
  return terms;
}

interface Utterance {
  speaker?: number;
  start: number;
  end: number;
  transcript: string;
}

export function parseUtterances(response: unknown): Segment[] {
  const utterances = (response as { results?: { utterances?: Utterance[] } })?.results?.utterances;
  if (!Array.isArray(utterances)) throw new Error("Deepgram response has no utterances; was utterances=true set?");
  return utterances
    .filter((u) => u.transcript.trim())
    .map((u) => ({
      speaker: `spk_${u.speaker ?? 0}`,
      startMs: Math.round(u.start * 1000),
      endMs: Math.round(u.end * 1000),
      text: u.transcript.trim(),
    }));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rewrite known mishearings as whole words, longest phrase first ("Tariq" → "Tarik"). */
export function applyCorrections(text: string, corrections: Correction[]): string {
  return [...corrections]
    .sort((a, b) => b.heard.length - a.heard.length)
    .reduce(
      (result, { heard, correct }) =>
        result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(heard)}(?![\\p{L}\\p{N}])`, "gu"), correct),
      text,
    );
}

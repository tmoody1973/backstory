import { normalizeForMatch } from "./evidence";

export interface Credit { role: string; name: string }
export interface Song {
  artist: string;
  title?: string;
  album?: string;
  releaseDate?: string; // YYYY-MM-DD
  credits: Credit[];
  releaseShow?: { venue: string; date: string };
  setList?: string[];
}
type Raw = {
  artist?: string | null; title?: string | null; album?: string | null; releaseDate?: string | null;
  credits?: Credit[] | null; releaseShow?: { venue: string; date: string } | null; setList?: string[] | null;
} | null | undefined;

const MONTHS = [
  ["january", "jan"], ["february", "feb"], ["march", "mar"], ["april", "apr"], ["may", "may"], ["june", "jun"],
  ["july", "jul"], ["august", "aug"], ["september", "sept", "sep"], ["october", "oct"], ["november", "nov"], ["december", "dec"],
];

/** "2026-10-23" is in the text when it says "Oct. 23" or "October 23". */
function dateInText(iso: string, words: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const names = MONTHS[Number(m[2]) - 1] ?? [];
  const day = String(Number(m[3]));
  return names.some((name) => ` ${words} `.includes(` ${name} ${day} `));
}

/**
 * The song record as the article supports it: a field stays only when its value appears in the article text
 * (the spec's "backed by the article"); no artist in the text, no record. Editors fix the rest in review.
 */
export function checkSong(raw: Raw, articleText: string): Song | null {
  const words = normalizeForMatch(articleText);
  const has = (value?: string | null): value is string => !!value && ` ${words} `.includes(` ${normalizeForMatch(value)} `);
  if (!raw || !has(raw.artist)) return null;
  const song: Song = { artist: raw.artist!, credits: (raw.credits ?? []).filter((c) => has(c.name)) };
  if (has(raw.title)) song.title = raw.title;
  if (has(raw.album)) song.album = raw.album;
  if (raw.releaseDate && dateInText(raw.releaseDate, words)) song.releaseDate = raw.releaseDate;
  if (raw.releaseShow && has(raw.releaseShow.venue) && dateInText(raw.releaseShow.date, words)) song.releaseShow = raw.releaseShow;
  const setList = (raw.setList ?? []).filter((title) => has(title));
  if (setList.length > 0) song.setList = setList;
  return song;
}

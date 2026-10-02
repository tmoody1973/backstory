import { normalizeForMatch, oneEditApart, type Segment } from "./evidence";
import type { JevAnswer } from "./jevTopics";
import type { ShowProfile } from "./shows";

const SOMEONE_ELSE = "someone else";
/** A speaker gets a suggested name only when Jev is this sure. */
export const SPEAKER_CONFIDENCE = 0.6;

/** Uniquely Milwaukee show notes end with "Episode host: <name>". */
// ponytail: takes a two-word name; three-word names need an editor fix
export function hostsFromShowNotes(showNotes: string): string[] {
  const spaced = showNotes.replace(/([a-z])([A-Z])/g, "$1 $2"); // "Paula LovoUniquely" → "Paula Lovo Uniquely"
  const match = spaced.match(/Episode host:\s*([A-Z][\w'’.-]*\s+[A-Z][\w'’.-]*)/);
  return match ? [match[1]] : [];
}

/** Same person when every word matches or is one letter off ("Tariq Moody" / "Tarik Moody", "Anne" / "Ann"). */
function sameName(a: string, b: string): boolean {
  const wa = normalizeForMatch(a).split(" ");
  const wb = normalizeForMatch(b).split(" ");
  return wa.length === wb.length && wa.every((w, i) => w === wb[i] || (w.length >= 3 && wb[i].length >= 3 && oneEditApart(w, wb[i])));
}

/**
 * Everyone who could plausibly be speaking: the show's hosts, a host named in the notes, the episode's people.
 * Earlier names win, so a host's correct spelling beats Transcribe's ("Tarik", not "Tariq").
 */
export function speakerCandidates(profile: ShowProfile, showNotes: string, people: string[]): string[] {
  const kept: string[] = [];
  for (const name of [...profile.hosts, ...hostsFromShowNotes(showNotes), ...people]) {
    if (normalizeForMatch(name) && !kept.some((other) => sameName(other, name))) kept.push(name);
  }
  return kept;
}

export function speakerLabels(segments: Segment[]): string[] {
  return [...new Set(segments.map((segment) => segment.speaker))];
}

export function speakerQuestions(labels: string[], candidates: string[]) {
  const criteria: Record<string, string | null> = Object.fromEntries(candidates.map((name) => [name, null]));
  criteria[SOMEONE_ELSE] = "A person not on this list, or the speaker can't be identified";
  return Object.fromEntries(
    labels.map((label) => [
      label,
      {
        type: "choice" as const,
        instructions: { speaker: label, question: `In this transcript, which person is speaking in the lines labeled ${label}?` },
        criteria,
      },
    ]),
  );
}

/** Confident matches only, most confident first, and each name used at most once. */
export function assignSpeakers(labels: string[], answers: Record<string, JevAnswer>) {
  const ranked = labels
    .flatMap((label) => {
      const { choice, confidence } = answers[label] ?? {};
      return choice && choice !== SOMEONE_ELSE && confidence !== undefined && confidence >= SPEAKER_CONFIDENCE
        ? [{ label, name: choice, confidence }]
        : [];
    })
    .sort((a, b) => b.confidence - a.confidence);
  const used = new Set<string>();
  const assigned = ranked.filter((match) => !used.has(match.name) && used.add(match.name));
  return labels.flatMap((label) => assigned.filter((match) => match.label === label));
}

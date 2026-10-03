import { normalizeForMatch } from "./evidence";
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
  mentions: { name: string; entityType: string; reviewStatus: string; removeReason?: string; doNotUse: boolean }[],
  places: { name: string; officialName?: string; removeReason?: string }[],
): string[] {
  const names = [
    ...mentions
      .filter((m) => (m.entityType === "person" && m.reviewStatus === "rejected") || m.removeReason === "sensitive" || m.doNotUse)
      .map((m) => m.name),
    ...places.filter((p) => p.removeReason === "sensitive").flatMap((p) => [p.name, p.officialName ?? ""]),
  ];
  return [...new Set(names.map(normalizeForMatch).filter(Boolean))];
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

// "What did Ann say about the stromboli?" → "stromboli": the question words and hosts are how a listener asks, not what's in the passage.
const ASKING_WORDS = new Set([
  "what", "did", "does", "do", "they", "say", "says", "said", "talk", "talked", "talking", "mention", "mentioned", "tell", "told",
  "which", "who", "when", "where", "how", "there", "their", "he", "she", "we", "you", "me", "us", "host", "hosts", "part",
  ...Object.values(SHOW_PROFILES).flatMap((show) => show.hosts.flatMap((host) => normalizeForMatch(host).split(" "))),
]);

export function detailWords(question: string): string {
  return normalizeForMatch(question).split(" ").filter((word) => word && !ASKING_WORDS.has(word)).join(" ");
}

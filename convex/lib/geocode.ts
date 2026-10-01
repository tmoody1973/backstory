import { normalizeForMatch } from "./evidence";

/** [longitude, latitude] of downtown Milwaukee, the order Amazon Location uses. */
export const MILWAUKEE_CENTER: [number, number] = [-87.9065, 43.0389];
export const MAX_DISTANCE_M = 40_000;
export const LOW_CONFIDENCE = 0.6;

// Words too generic to tell two places apart.
const STOP_WORDS = new Set(["the", "and", "of", "a", "cafe", "restaurant", "bar", "grill", "milwaukee"]);

export interface GeoCandidate {
  title: string;
  position: [number, number];
  distanceM?: number;
  label?: string;
}

function nameWords(text: string): Set<string> {
  return new Set(normalizeForMatch(text).split(" ").filter((word) => word && !STOP_WORDS.has(word)));
}

/** Share of the place's distinctive name words found in the result title; 0 if it's out of town. */
// ponytail: word overlap, not fuzzy matching; switch to trigram similarity if misspelled names show up in review
export function scoreCandidate(placeName: string, candidate: GeoCandidate): number {
  if (candidate.distanceM !== undefined && candidate.distanceM > MAX_DISTANCE_M) return 0;
  const want = nameWords(placeName);
  if (want.size === 0) return 0;
  const got = nameWords(candidate.title);
  let found = 0;
  for (const word of want) if (got.has(word)) found++;
  return found / want.size;
}

export function pickBest(
  placeName: string,
  candidates: GeoCandidate[],
): { candidate: GeoCandidate; confidence: number } | null {
  let best: { candidate: GeoCandidate; confidence: number } | null = null;
  for (const candidate of candidates) {
    const confidence = scoreCandidate(placeName, candidate);
    if (!best || confidence > best.confidence) best = { candidate, confidence };
  }
  return best;
}

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE;
}

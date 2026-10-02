import { normalizeForMatch, oneEditApart } from "./evidence";

/** [longitude, latitude] of downtown Milwaukee, the order Amazon Location uses. */
export const MILWAUKEE_CENTER: [number, number] = [-87.9065, 43.0389];
export const MAX_DISTANCE_M = 40_000;
export const LOW_CONFIDENCE = 0.6;
/** Two strong matches farther apart than this are different locations of one name. */
const SAME_PLACE_M = 200;
/** Confidence given to a name with several real locations: below LOW_CONFIDENCE, so an editor picks. */
const AMBIGUOUS_CONFIDENCE = 0.5;

// Words too generic to tell two places apart.
const STOP_WORDS = new Set(["the", "and", "of", "a", "cafe", "restaurant", "bar", "grill", "milwaukee"]);

export interface GeoCandidate {
  title: string;
  position: [number, number];
  distanceM?: number;
  label?: string;
  /** Amazon Location's PlaceType; only "PointOfInterest" (businesses, venues, parks) can be pinned. */
  placeType?: string;
}

export type GeocodeDecision =
  | { lat: number; lng: number; label: string | undefined; officialName: string; confidence: number }
  | { confidence: number };

/** "Cuisines" and "Cuisine" are the same name word. */
// ponytail: trailing-s stem only; add a real stemmer if review shows other inflections
const stem = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);

function nameWords(text: string): Set<string> {
  return new Set(normalizeForMatch(text).split(" ").filter((word) => word && !STOP_WORDS.has(word)).map(stem));
}

/** Same word, or a one-letter mishearing of a word of 4+ letters (Transcribe heard "Emmy's" for Immy's). */
const sameWord = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && oneEditApart(a, b));

/** Shared distinctive words over all distinct words (Jaccard, counting near-matches as shared); 0 if it's out of town. */
// ponytail: word overlap, not fuzzy matching; switch to trigram similarity if misspelled names show up in review
export function scoreCandidate(placeName: string, candidate: GeoCandidate): number {
  if (candidate.distanceM !== undefined && candidate.distanceM > MAX_DISTANCE_M) return 0;
  const want = nameWords(placeName);
  if (want.size === 0) return 0;
  const got = [...nameWords(candidate.title)];
  let shared = 0;
  for (const word of want) if (got.some((other) => sameWord(word, other))) shared++;
  return shared / (want.size + got.length - shared);
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

/** Great-circle distance in meters between two [lng, lat] points. */
function metersBetween([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/**
 * What to store for a place. Coordinates only for one confident, in-town business match;
 * street addresses are never pinned (a Uniquely Milwaukee story must not locate a resident's home),
 * and a name with several locations goes to the editor instead of a guessed pin.
 */
export function geocodeDecision(placeName: string, candidates: GeoCandidate[]): GeocodeDecision {
  const pois = candidates.filter((candidate) => candidate.placeType === "PointOfInterest");
  const best = pickBest(placeName, pois);
  if (!best || isLowConfidence(best.confidence)) return { confidence: best?.confidence ?? 0 };
  const rivals = pois.filter(
    (candidate) =>
      !isLowConfidence(scoreCandidate(placeName, candidate)) &&
      metersBetween(candidate.position, best.candidate.position) > SAME_PLACE_M,
  );
  if (rivals.length > 0) return { confidence: AMBIGUOUS_CONFIDENCE };
  const [lng, lat] = best.candidate.position;
  return { lat, lng, label: best.candidate.label, officialName: best.candidate.title, confidence: best.confidence };
}

/** An editor typed an address: trust the map service's top match, as long as it's in the Milwaukee area. */
export function addressMatch(candidates: GeoCandidate[]): { lat: number; lng: number; label: string } | null {
  const top = candidates[0];
  if (!top || top.distanceM === undefined || top.distanceM > MAX_DISTANCE_M) return null;
  return { lat: top.position[1], lng: top.position[0], label: top.label ?? top.title };
}

import { isLowConfidence } from "./geocode";

/** Why an item needs a reviewer's eyes; null means it probably doesn't. The review page lists these first. */
export type Attention = "no_pin" | "uncertain_pin" | "passing_mention";

export function placeAttention(place: { geocodeConfidence?: number; lat?: number }): Attention | null {
  if (!place.geocodeConfidence || place.lat === undefined) return "no_pin";
  return isLowConfidence(place.geocodeConfidence) ? "uncertain_pin" : null;
}

/** Jev's subject score below one half: probably named in passing, not someone the story is about. */
export function mentionAttention(mention: { entityType: string; subjectConfidence?: number }): Attention | null {
  return mention.entityType === "person" && mention.subjectConfidence !== undefined && mention.subjectConfidence < 0.5 ? "passing_mention" : null;
}

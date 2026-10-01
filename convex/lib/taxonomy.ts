// Copied from mke-field-guide src/enrichment/tag.ts (CATEGORY_VALUES), 2026-10-01.
// Stories and events share one vocabulary so they join without a mapping layer.
// Adding a topic is an editor decision recorded here, never something the model invents.
export const TOPIC_VALUES = [
  "music", "comedy", "sports", "festival", "family", "food-drink", "arts", "community", "other",
] as const;

export type Topic = (typeof TOPIC_VALUES)[number];

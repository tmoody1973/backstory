/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionArgs, WithoutSystemFields } from "convex/server";
import { vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

// The convex/aws actions only call live AWS services, so tests never load them.
export const modules = import.meta.glob(["../convex/**/*.*s", "!../convex/aws/**"]);

export function makeTest() {
  vi.useFakeTimers(); // scheduled pipeline steps stay queued instead of firing mid-test
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof makeTest>;

export async function seedStory(
  t: TestConvex,
  overrides: Partial<WithoutSystemFields<Doc<"stories">>> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("stories", {
      cdsId: "fis-test-1",
      showSlug: "this-bites",
      contentType: "episode",
      title: "Freshwater Food & Wine Festival, Café Corazón and turkey talk",
      teaserText: "We bid a bittersweet farewell to Café Corazón in Bay View.",
      publishedAt: Date.UTC(2026, 8, 18, 15),
      audioUrl: "https://example.com/this-bites.mp3",
      durationSec: 999,
      stage: "ingested",
      reviewStatus: "pending",
      doNotUse: false,
      ...overrides,
    }),
  );
}

export type RunResult = FunctionArgs<typeof internal.extractions.save>["result"];

/** A checked extraction whose quotes all exist in tests/fixtures/segments.ts. */
export const SAMPLE_RESULT: RunResult = {
  summary: "The hosts preview the Freshwater Food & Wine Festival. They say goodbye to Café Corazón's Bay View location.",
  mentions: [
    { entityType: "place", name: "Café Corazón", placeCategory: "restaurant", relatedPlace: null, quote: "a bittersweet farewell to Café Corazón in Bay View", startMs: 4000, speaker: "spk_1" },
    { entityType: "person", name: "Joe Sasto", placeCategory: null, relatedPlace: null, quote: "chefs Joe Sasto and Dan Jacobs", startMs: 20000, speaker: "spk_0" },
  ],
  topics: [{ topic: "food-drink", confidence: 0.95, quote: "a bittersweet farewell to Café Corazón", startMs: 4000, speaker: "spk_1" }],
  actions: [
    { kind: "visit", label: "Visit Café Corazón in Riverwest", placeName: "Café Corazón", quote: "their Riverwest and Brown Deer locations remain open", startMs: 9000, speaker: "spk_1" },
  ],
};

/** Saves an extraction run the way the extract step does. */
export async function saveRun(t: TestConvex, storyId: Id<"stories">, runId: string, result: RunResult = SAMPLE_RESULT) {
  const jobId = await t.run((ctx) =>
    ctx.db.insert("jobs", { kind: "extract", storyId, status: "running", attempts: 0, updatedAt: 0 }),
  );
  await t.mutation(internal.extractions.save, { jobId, storyId, runId, result });
  return jobId;
}

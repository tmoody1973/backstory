/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { WithoutSystemFields } from "convex/server";
import { vi } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
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

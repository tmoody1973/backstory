import { describe, expect, it } from "vitest";
import { buildTranscriptIndex } from "../../convex/lib/evidence";
import {
  applyEvidence, buildExtractionPrompt, extractionJsonSchema, extractionSchema, type Extraction,
} from "../../convex/lib/extraction";
import { getShowProfile } from "../../convex/lib/shows";
import { TEST_SEGMENTS } from "../fixtures/segments";

const profile = getShowProfile("this-bites");
const index = buildTranscriptIndex(TEST_SEGMENTS);

const raw: Extraction = {
  summary: "The hosts preview a food festival. They say goodbye to one Café Corazón location.",
  mentions: [
    { entityType: "place", name: "Café Corazón", placeCategory: "restaurant", relatedPlace: null, quote: "a bittersweet farewell to Café Corazón in Bay View" },
    { entityType: "dish", name: "churros", placeCategory: null, relatedPlace: "Café Colada", quote: "Café Colada serves churros and empanadas" },
    { entityType: "person", name: "Gordon Ramsay", placeCategory: null, relatedPlace: null, quote: "Gordon Ramsay cooked at the festival" },
    { entityType: "place", name: "Bay View Market", placeCategory: null, relatedPlace: null, quote: "farewell to Café Corazón in Bay View" },
    { entityType: "dish", name: "empanadas", placeCategory: null, relatedPlace: null, quote: "serves churros and empanadas in Cathedral" },
  ],
  topics: [{ topic: "food-drink", confidence: 0.9, quote: "a bittersweet farewell to Café Corazón" }],
  actions: [
    { kind: "visit", label: "Visit Café Corazón in Riverwest", placeName: "Café Corazón", quote: "their Riverwest and Brown Deer locations remain open" },
    { kind: "support", label: "Donate", placeName: null, quote: "their Riverwest and Brown Deer locations remain open" },
    { kind: "attend", label: "Catch the cooking battle", placeName: "Summerfest grounds", quote: "The live cooking battle pits chefs Joe Sasto" },
  ],
};

describe("applyEvidence", () => {
  const checked = applyEvidence(raw, index, profile);

  it("keeps supported mentions and records where their quotes start", () => {
    expect(checked.mentions.map((m) => m.name)).toEqual(["Café Corazón", "churros"]);
    expect(checked.mentions[0]).toMatchObject({ startMs: 4000, speaker: "spk_1" });
  });

  it("drops a mention whose quote is not in the transcript", () => {
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "Gordon Ramsay", reason: "quote not found in transcript" });
  });

  it("drops a mention whose real quote does not name it", () => {
    const invented: Extraction = {
      ...raw,
      mentions: [{ entityType: "place", name: "Joe's Pizza", placeCategory: "restaurant", relatedPlace: null, quote: "Welcome back to This Bites" }],
    };
    const result = applyEvidence(invented, index, profile);
    expect(result.mentions).toEqual([]);
    expect(result.dropped).toContainEqual({ kind: "mention", name: "Joe's Pizza", reason: "quote does not name it" });
  });

  it("drops a place with no category and a dish with no restaurant", () => {
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "Bay View Market", reason: "place without a category" });
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "empanadas", reason: "dish without the place that serves it" });
  });

  it("drops action kinds the show does not use", () => {
    expect(checked.actions.map((a) => a.kind)).toEqual(["visit", "attend"]);
    expect(checked.dropped).toContainEqual({ kind: "action", name: "Donate", reason: "action kind support not in show profile" });
  });

  it("keeps an action's place only if that place survived the check", () => {
    expect(checked.actions[0].placeName).toBe("Café Corazón");
    expect(checked.actions[1].placeName).toBeNull();
  });

  it("keeps supported topics", () => {
    expect(checked.topics).toEqual([
      { topic: "food-drink", confidence: 0.9, quote: "a bittersweet farewell to Café Corazón", startMs: 4000, speaker: "spk_1" },
    ]);
  });
});

describe("applyEvidence with the Uniquely Milwaukee profile", () => {
  it("drops entity types that show does not use", () => {
    const checked = applyEvidence(raw, index, getShowProfile("uniquely-milwaukee"));
    expect(checked.mentions.map((m) => m.name)).toEqual(["Café Corazón"]);
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "churros", reason: "entity type dish not in show profile" });
    expect(checked.actions.map((a) => a.kind)).toEqual(["visit", "support", "attend"]);
  });
});

describe("extractionSchema", () => {
  it("rejects a topic outside the Field Guide vocabulary", () => {
    const bad = { ...raw, topics: [{ topic: "civic-life", confidence: 0.8, quote: "x" }] };
    expect(extractionSchema.safeParse(bad).success).toBe(false);
  });

  it("produces a Bedrock-ready JSON schema without the $schema key", () => {
    const schema = extractionJsonSchema();
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toHaveProperty(["properties", "summary"]);
  });
});

describe("buildExtractionPrompt", () => {
  const prompt = buildExtractionPrompt({
    profile, title: "Test", teaserText: "Show notes text", publishedAt: Date.UTC(2026, 8, 18), segments: TEST_SEGMENTS,
  });

  it("labels each transcript line with speaker and time", () => {
    expect(prompt).toContain("[spk_1 00:04] We bid a bittersweet farewell to Café Corazón in Bay View,");
  });

  it("asks for quotes that name what they support", () => {
    expect(prompt).toContain("A mention's quote must contain its name");
  });

  it("forbids quoting the show notes", () => {
    expect(prompt).toContain("SHOW NOTES are for spelling names correctly only. Never quote them.");
    expect(prompt).toContain("Show notes text");
  });
});

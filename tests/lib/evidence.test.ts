import { describe, expect, it } from "vitest";
import { buildTranscriptIndex, findEvidence, normalizeForMatch } from "../../convex/lib/evidence";
import { TEST_SEGMENTS } from "../fixtures/segments";

const index = buildTranscriptIndex(TEST_SEGMENTS);

describe("normalizeForMatch", () => {
  it("drops case, accents, apostrophes and punctuation", () => {
    expect(normalizeForMatch("  Café Corazón — Walker’s Point!  ")).toBe("cafe corazon walkers point");
  });
});

describe("findEvidence", () => {
  it("accepts a verbatim quote and returns where it starts", () => {
    expect(findEvidence(index, "a bittersweet farewell to Café Corazón")).toEqual({ startMs: 4000, speaker: "spk_1" });
  });

  it("accepts the same quote with different spacing, case, punctuation and accents", () => {
    expect(findEvidence(index, "A  bittersweet farewell to cafe corazon!")).toEqual({ startMs: 4000, speaker: "spk_1" });
  });

  it("accepts curly apostrophes", () => {
    expect(findEvidence(index, "a morning milkshake at Ted’s")).toEqual({ startMs: 14000, speaker: "spk_0" });
  });

  it("accepts a quote that runs across two segments", () => {
    expect(findEvidence(index, "Corazón in Bay View, but their Riverwest")).toEqual({ startMs: 4000, speaker: "spk_1" });
  });

  it("rejects a fabricated quote", () => {
    expect(findEvidence(index, "Café Corazón is closing all of its locations")).toBeNull();
  });

  it("rejects a quote that only matches part of a word", () => {
    expect(findEvidence(index, "bittersweet farewell to Café Corazó")).toBeNull();
  });

  it("rejects quotes shorter than four words", () => {
    expect(findEvidence(index, "Café Corazón")).toBeNull();
  });

  it("finds nothing in an empty transcript", () => {
    expect(findEvidence(buildTranscriptIndex([]), "a bittersweet farewell to Café Corazón")).toBeNull();
  });
});

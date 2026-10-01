import { describe, expect, it } from "vitest";
import { isLowConfidence, pickBest, scoreCandidate, type GeoCandidate } from "../../convex/lib/geocode";

const near = (title: string, distanceM = 3000): GeoCandidate => ({ title, position: [-87.9, 43.03], distanceM });

describe("scoreCandidate", () => {
  it("scores an exact name match nearby as 1", () => {
    expect(scoreCandidate("Café Corazón", near("Cafe Corazon"))).toBe(1);
  });

  it("scores a result that shares only one name word low", () => {
    expect(scoreCandidate("Hong Anh Palace", near("Palace Theater"))).toBeCloseTo(1 / 3);
  });

  it("scores anything more than 40 km from Milwaukee as 0", () => {
    expect(scoreCandidate("Café Corazón", near("Café Corazón", 120_000))).toBe(0);
  });
});

describe("pickBest", () => {
  it("chooses the strongest candidate", () => {
    const best = pickBest("Hong Anh Palace", [near("Palace Theater"), near("Hong Anh Palace Restaurant")]);
    expect(best?.candidate.title).toBe("Hong Anh Palace Restaurant");
    expect(best?.confidence).toBe(1);
  });

  it("returns null when there are no candidates", () => {
    expect(pickBest("Café Corazón", [])).toBeNull();
  });
});

describe("isLowConfidence", () => {
  it("flags weak matches for the editor", () => {
    expect(isLowConfidence(1 / 3)).toBe(true);
    expect(isLowConfidence(1)).toBe(false);
  });
});

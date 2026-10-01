import { describe, expect, it } from "vitest";
import { geocodeDecision, isLowConfidence, LOW_CONFIDENCE, pickBest, scoreCandidate, type GeoCandidate } from "../../convex/lib/geocode";

const near = (title: string, distanceM = 3000, position: [number, number] = [-87.9, 43.03]): GeoCandidate => ({
  title, position, distanceM, placeType: "PointOfInterest",
});

describe("scoreCandidate", () => {
  it("scores an exact name match nearby as 1", () => {
    expect(scoreCandidate("Café Corazón", near("Cafe Corazon"))).toBe(1);
  });

  it("scores a result that shares only one name word low", () => {
    expect(scoreCandidate("Hong Anh Palace", near("Palace Theater"))).toBeCloseTo(1 / 4);
  });

  it("scores a result with extra distinctive words low", () => {
    expect(isLowConfidence(scoreCandidate("Ardent", near("Ardent Dental")))).toBe(true);
  });

  it("treats singular and plural as the same word", () => {
    expect(scoreCandidate("Emmy's African Cuisines", near("Emmy's African Cuisine"))).toBe(1);
  });

  it("tolerates a one-letter mishearing in a longer name word", () => {
    expect(scoreCandidate("Emmy's African Cuisines", near("Immy's African Cuisine"))).toBe(1);
  });

  it("does not treat short words one letter apart as the same", () => {
    expect(isLowConfidence(scoreCandidate("Bar", near("Bay")))).toBe(true);
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

describe("geocodeDecision", () => {
  it("pins a single strong nearby match", () => {
    expect(geocodeDecision("Café Corazón", [near("Cafe Corazon", 3000, [-87.9, 42.99])])).toEqual({
      lng: -87.9, lat: 42.99, label: undefined, confidence: 1,
    });
  });

  it("stores no coordinates when every match is out of town", () => {
    expect(geocodeDecision("Café Corazón", [near("Café Corazón", 120_000)])).toEqual({ confidence: 0 });
  });

  it("stores no coordinates for a weak match", () => {
    const decision = geocodeDecision("Hong Anh Palace", [near("Palace Theater")]);
    expect(decision).not.toHaveProperty("lat");
    expect(isLowConfidence(decision.confidence)).toBe(true);
  });

  it("flags a name with several locations instead of guessing one", () => {
    const decision = geocodeDecision("Café Corazón", [
      near("Café Corazón", 3000, [-87.9, 42.99]), // Bay View
      near("Café Corazón", 4000, [-87.89, 43.08]), // Riverwest, ~10 km away
    ]);
    expect(decision).not.toHaveProperty("lat");
    expect(decision.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("treats near-identical duplicate listings as one place", () => {
    const decision = geocodeDecision("Café Corazón", [
      near("Café Corazón", 3000, [-87.9, 42.99]),
      near("Café Corazón", 3000, [-87.9001, 42.9901]),
    ]);
    expect(decision).toMatchObject({ confidence: 1, lat: 42.99 });
  });

  it("never pins a street address, only businesses and venues", () => {
    const home: GeoCandidate = { title: "2900 N Booth St", position: [-87.9, 43.07], distanceM: 5000, placeType: "PointAddress" };
    expect(geocodeDecision("2900 N Booth St", [home])).toEqual({ confidence: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { getShowProfile } from "../../convex/lib/shows";
import { TOPIC_VALUES } from "../../convex/lib/taxonomy";

describe("show profiles", () => {
  it("returns the This Bites profile with its CDS podcast channel", () => {
    const profile = getShowProfile("this-bites");
    expect(profile.name).toBe("This Bites");
    expect(profile.cdsCollectionId).toBe("718413877");
    expect(profile.entityTypes).toContain("dish");
    expect(profile.actionKinds).toContain("reserve");
  });

  it("returns the Uniquely Milwaukee profile: community stories, no dishes or reservations", () => {
    const profile = getShowProfile("uniquely-milwaukee");
    expect(profile.name).toBe("Uniquely Milwaukee");
    expect(profile.cdsCollectionId).toBe("718414860");
    expect(profile.entityTypes).toEqual(["person", "organization", "place", "event"]);
    expect(profile.actionKinds).toEqual(["visit", "attend", "support", "remember"]);
  });

  it("tells extraction to skip program participants and minors in Uniquely Milwaukee stories", () => {
    expect(getShowProfile("uniquely-milwaukee").extractionNotes).toContain(
      "Never extract a participant in a program, a resident of a facility, a patient, or a minor",
    );
  });

  it("throws a clear error for an unknown show", () => {
    expect(() => getShowProfile("nope")).toThrow('Unknown show "nope"');
  });
});

describe("topic vocabulary", () => {
  it("is the Field Guide's event categories plus the station's story topics", () => {
    expect(TOPIC_VALUES).toEqual([
      "music", "comedy", "sports", "festival", "family", "food-drink", "arts", "community", "other",
      "civic-life", "history", "education", "business",
    ]);
  });
});

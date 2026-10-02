import { describe, expect, it } from "vitest";
import { mentionAttention, placeAttention } from "../../convex/lib/attention";

describe("why an item needs a reviewer", () => {
  it("flags a place with no map pin, or a pin the map service wasn't sure of", () => {
    expect(placeAttention({ geocodeConfidence: undefined })).toBe("no_pin");
    expect(placeAttention({ geocodeConfidence: 0 })).toBe("no_pin");
    expect(placeAttention({ geocodeConfidence: 0.5, lat: 43 })).toBe("uncertain_pin");
    expect(placeAttention({ geocodeConfidence: 0.9, lat: 43 })).toBeNull();
  });
  it("flags a person who may only be mentioned in passing", () => {
    expect(mentionAttention({ entityType: "person", subjectConfidence: 0.3 })).toBe("passing_mention");
    expect(mentionAttention({ entityType: "person", subjectConfidence: 0.8 })).toBeNull();
    expect(mentionAttention({ entityType: "organization" })).toBeNull();
  });
});

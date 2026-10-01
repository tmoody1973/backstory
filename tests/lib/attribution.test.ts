import { describe, expect, it } from "vitest";
import { attribution } from "../../convex/lib/attribution";

describe("attribution", () => {
  it("names the show and the month the episode came out", () => {
    expect(attribution("This Bites", Date.UTC(2026, 8, 18, 15))).toBe("This Bites, September 2026");
  });
});

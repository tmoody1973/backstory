import { describe, expect, it } from "vitest";
import { extractionSchema, trimToCaps } from "../../convex/lib/extraction";
import { getShowProfile } from "../../convex/lib/shows";

describe("artist: musicians and bands", () => {
  it("the music shows and Ladies First extract artists, and say bands are artists, not organizations", () => {
    for (const slug of ["milwaukee-music-premiere", "studio-milwaukee", "ladies-first"]) {
      const profile = getShowProfile(slug);
      expect(profile.entityTypes).toContain("artist");
      expect(profile.extractionNotes).toMatch(/bands?[^.]*\bartist\b/i);
      expect(profile.extractionNotes).not.toMatch(/bands[^.]*are organizations/i);
    }
  });
  it("podcasts keep their types", () => {
    expect(getShowProfile("this-bites").entityTypes).not.toContain("artist");
  });
  it("an artist mention survives validation", () => {
    const out = extractionSchema.parse(trimToCaps({ summary: "s", topics: [], actions: [], mentions: [
      { entityType: "artist", name: "Tank & The Bangas", quote: "q", placeCategory: null, relatedPlace: null },
    ] }));
    expect(out.mentions.map((m) => m.entityType)).toEqual(["artist"]);
  });
});

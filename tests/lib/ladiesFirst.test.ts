import { describe, expect, it } from "vitest";
import { buildShowQueryUrl, parseEpisode, type CdsDocument } from "../../convex/lib/cds";
import { getShowProfile } from "../../convex/lib/shows";

// The shape of a Ladies First station story in CDS (g-s921-16911, trimmed): audio and the artist's photo as assets.
const story = {
  id: "g-s921-16911",
  title: "Ladies First: Ambré",
  teaser: "From a music-filled upbringing in New Orleans, Ambré has evolved into a fiercely authentic artist.",
  publishDateTime: "2026-10-02T12:00:00-05:00",
  audio: [{ href: "#/assets/g-s921-16912", rels: ["primary", "headline"] }],
  images: [{ href: "#/assets/g-s921-16919", rels: ["primary"] }],
  webPages: [{ href: "https://radiomilwaukee.org/show/ladies-first/2026-10-02/ambre-peyote-new-album", rels: ["canonical"] }],
  assets: {
    "g-s921-16912": { duration: 670, enclosures: [{ href: "https://dovetail.prxu.org/17913/ab98/Ladies_First_Ambre_100226.mp3", type: "audio/mpeg" }] },
    "g-s921-16919": { enclosures: [
      { href: "https://npr.brightspotcdn.com/wide/ambre.jpg", rels: ["image-wide", "scalable"] },
      { href: "https://npr.brightspotcdn.com/square/ambre.jpg", rels: ["image-square", "scalable"] },
    ] },
  },
} as unknown as CdsDocument;

describe("Ladies First", () => {
  it("is a station series of stories, not a podcast channel: the query asks for stories in its collection", () => {
    const profile = getShowProfile("ladies-first");
    // Transcript check 2026-10-04 (17 episodes): no song stretches, no repeated chorus lines, 2-3 speakers each: quoting on.
    expect(profile).toMatchObject({ cdsCollectionId: "g-s921-13049", cdsProfile: "story", detailedAnswersDefault: true });
    const url = new URL(buildShowQueryUrl(profile.cdsCollectionId, 10, profile.cdsProfile));
    expect(url.searchParams.get("profileIds")).toBe("story");
    expect(url.searchParams.get("collectionIds")).toBe("g-s921-13049");
  });

  it("podcast shows keep asking for podcast episodes", () => {
    expect(getShowProfile("this-bites").cdsProfile).toBe("podcast-episode");
    expect(new URL(buildShowQueryUrl("718413877", 10)).searchParams.get("profileIds")).toBe("podcast-episode");
  });

  it("a story episode carries its own photo (the square crop), its audio and its page", () => {
    expect(parseEpisode(story)).toMatchObject({
      cdsId: "g-s921-16911", audioUrl: "https://dovetail.prxu.org/17913/ab98/Ladies_First_Ambre_100226.mp3", durationSec: 670,
      imageUrl: "https://npr.brightspotcdn.com/square/ambre.jpg",
      permalink: "https://radiomilwaukee.org/show/ladies-first/2026-10-02/ambre-peyote-new-album",
    });
  });

  it("the extraction notes forbid lyrics", () => {
    expect(getShowProfile("ladies-first").extractionNotes).toMatch(/lyrics/i);
  });
});

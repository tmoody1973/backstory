import { describe, expect, it } from "vitest";
import { extractionSchema, trimToCaps } from "../../convex/lib/extraction";

const base = { summary: "An interview with Lachi.", mentions: [], topics: [], actions: [] };
const parse = (raw: unknown) => extractionSchema.parse(trimToCaps(raw));

describe("an invented value drops that one item, not the episode", () => {
  it("topics outside the taxonomy are dropped (Lachi: the model invented a topic three times running)", () => {
    const out = parse({ ...base, topics: [
      { topic: "music", confidence: 0.9, quote: "q" },
      { topic: "disability-advocacy", confidence: 0.8, quote: "q" },
    ] });
    expect(out.topics.map((t) => t.topic)).toEqual(["music"]);
  });
  it("mentions of a type Backstory doesn't keep (an album, a song) are dropped", () => {
    const out = parse({ ...base, mentions: [
      { entityType: "person", name: "Lachi", quote: "q", placeCategory: null, relatedPlace: null },
      { entityType: "album", name: "Lachi Lachi", quote: "q", placeCategory: null, relatedPlace: null },
    ] });
    expect(out.mentions.map((m) => m.name)).toEqual(["Lachi"]);
  });
  it("actions of an unknown kind are dropped", () => {
    const out = parse({ ...base, actions: [
      { kind: "listen", label: "Stream the album", placeName: null, quote: "q" },
      { kind: "attend", label: "See her live", placeName: null, quote: "q" },
    ] });
    expect(out.actions.map((a) => a.kind)).toEqual(["attend"]);
  });
  it("caps count only kept items", () => {
    const topics = [{ topic: "nope", confidence: 1, quote: "q" }, ...["music", "arts", "community"].map((topic) => ({ topic, confidence: 1, quote: "q" }))];
    expect(parse({ ...base, topics }).topics.map((t) => t.topic)).toEqual(["music", "arts", "community"]);
  });
});

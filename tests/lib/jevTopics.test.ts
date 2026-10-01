import { describe, expect, it } from "vitest";
import { buildTranscriptIndex, findEvidence } from "../../convex/lib/evidence";
import {
  evidenceQuestions, passageCandidates, pickEvidence, pickTopics, topicQuestions, transcriptState,
} from "../../convex/lib/jevTopics";
import { TOPIC_VALUES } from "../../convex/lib/taxonomy";
import { TEST_SEGMENTS } from "../fixtures/segments";

describe("topicQuestions", () => {
  it("asks one yes/no question per topic in the vocabulary", () => {
    const questions = topicQuestions();
    expect(Object.keys(questions)).toEqual([...TOPIC_VALUES]);
    expect(questions["food-drink"]).toMatchObject({ type: "noul" });
  });

  it("describes the Field Guide short names in full words", () => {
    expect(JSON.stringify(topicQuestions().arts)).toContain("Arts and culture");
  });
});

describe("pickTopics", () => {
  const answers = {
    "food-drink": { type: "noul", noul: 0.97 },
    festival: { type: "noul", noul: 0.81 },
    community: { type: "noul", noul: 0.62 },
    business: { type: "noul", noul: 0.55 },
    arts: { type: "noul", noul: 0.2 },
  };

  it("keeps the three most likely topics above the threshold, most likely first", () => {
    expect(pickTopics(answers)).toEqual([
      { topic: "food-drink", confidence: 0.97 },
      { topic: "festival", confidence: 0.81 },
      { topic: "community", confidence: 0.62 },
    ]);
  });

  it("returns nothing when no topic clears the threshold", () => {
    expect(pickTopics({ arts: { type: "noul", noul: 0.3 } })).toEqual([]);
  });

  it("ignores answers for labels outside the vocabulary", () => {
    expect(pickTopics({ gossip: { type: "noul", noul: 0.99 } })).toEqual([]);
  });
});

describe("passageCandidates", () => {
  it("offers only passages long enough to be evidence", () => {
    const candidates = passageCandidates([...TEST_SEGMENTS, { speaker: "spk_0", startMs: 40000, endMs: 41000, text: "Yeah." }]);
    expect(candidates.map((c) => c.text)).not.toContain("Yeah.");
    expect(candidates).toHaveLength(TEST_SEGMENTS.length);
  });

  it("merges neighbouring segments when there are more than a Choice allows", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ speaker: "spk_0", startMs: i * 1000, endMs: i * 1000 + 900, text: `Passage number ${i} has enough words.` }));
    const candidates = passageCandidates(many);
    expect(candidates.length).toBeLessThanOrEqual(255);
    expect(candidates[0].text).toContain("Passage number 0");
    expect(candidates[0].startMs).toBe(0);
  });
});

describe("evidence selection", () => {
  const candidates = passageCandidates(TEST_SEGMENTS);

  it("asks one multiple-choice question per chosen topic, with transcript passages as the options", () => {
    const questions = evidenceQuestions([{ topic: "food-drink", confidence: 0.9 }], candidates);
    expect(questions["food-drink"]).toMatchObject({ type: "choice" });
    expect(Object.values(questions["food-drink"].criteria)).toContain(TEST_SEGMENTS[5].text);
  });

  it("copies the chosen passage exactly, so the quote always passes the evidence check", () => {
    const picked = pickEvidence(
      [{ topic: "food-drink", confidence: 0.9 }],
      { "food-drink": { type: "choice", choice: candidates[5].id, confidence: 0.8, probabilities: {} } },
      candidates,
    );
    expect(picked).toEqual([
      { topic: "food-drink", confidence: 0.9, quote: TEST_SEGMENTS[5].text, startMs: 26000, speaker: "spk_1" },
    ]);
    expect(findEvidence(buildTranscriptIndex(TEST_SEGMENTS), picked[0].quote)).not.toBeNull();
  });

  it("drops a topic whose answer names no known passage", () => {
    expect(pickEvidence([{ topic: "arts", confidence: 0.7 }], { arts: { type: "choice", choice: "p999", confidence: 0.5, probabilities: {} } }, candidates)).toEqual([]);
  });
});

describe("transcriptState", () => {
  it("is the transcript as plain speaker-labelled lines", () => {
    expect(transcriptState(TEST_SEGMENTS.slice(0, 1))).toBe("spk_0: Welcome back to This Bites.");
  });
});

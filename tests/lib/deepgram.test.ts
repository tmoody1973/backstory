import { describe, expect, it } from "vitest";
import { applyCorrections, deepgramKeyterms, parseUtterances, showNoteNames } from "../../convex/lib/deepgram";
import { getShowProfile } from "../../convex/lib/shows";

describe("showNoteNames", () => {
  it("pulls capitalized names from show notes, without gluing two people together", () => {
    expect(showNoteNames("We bid farewell to Café Corazón in Bay View with chefs Joe Sasto and Dan Jacobs.")).toEqual([
      "Café Corazón", "Bay View", "Joe Sasto", "Dan Jacobs",
    ]);
  });
});

describe("deepgramKeyterms", () => {
  it("starts with the show's hosts, then known names, then the episode's show-notes names, without duplicates", () => {
    const terms = deepgramKeyterms(getShowProfile("this-bites"), "Chefs Joe Sasto and Tarik Moody", ["Cocina Filipina"]);
    expect(terms.slice(0, 4)).toEqual(["Tarik Moody", "Ann Christenson", "Cocina Filipina", "Joe Sasto"]);
    expect(terms.filter((t) => t === "Tarik Moody")).toHaveLength(1);
  });

  it("stays inside Deepgram's 500-token keyterm limit", () => {
    const many = Array.from({ length: 400 }, (_, i) => `Restaurant Number ${i}`);
    const words = deepgramKeyterms(getShowProfile("this-bites"), "", many).join(" ").split(" ").length;
    expect(words).toBeLessThanOrEqual(300);
  });
});

describe("parseUtterances", () => {
  it("turns Deepgram utterances into speaker-labeled segments in milliseconds", () => {
    const response = { results: { utterances: [
      { speaker: 0, start: 0.5, end: 2.25, transcript: "Welcome to This Bites." },
      { speaker: 1, start: 2.4, end: 3.0, transcript: "  " },
      { speaker: 1, start: 3.1, end: 6.0, transcript: "Thanks, Tarik." },
    ] } };
    expect(parseUtterances(response)).toEqual([
      { speaker: "spk_0", startMs: 500, endMs: 2250, text: "Welcome to This Bites." },
      { speaker: "spk_1", startMs: 3100, endMs: 6000, text: "Thanks, Tarik." },
    ]);
  });

  it("starts a new segment where the speaker changes mid-utterance (Deepgram splits utterances only on pauses)", () => {
    const w = (word: string, speaker: number, start: number, end: number) => ({ punctuated_word: word, speaker, start, end });
    const response = { results: { utterances: [{
      speaker: 1, start: 6.4, end: 13.0, transcript: "…",
      words: [w("Julianna", 1, 6.4, 6.9), w("started", 1, 7.0, 7.4), w("here.", 1, 7.5, 11.6), w("Well,", 2, 11.7, 11.9), w("what", 2, 12.0, 13.0)],
    }] } };
    expect(parseUtterances(response)).toEqual([
      { speaker: "spk_1", startMs: 6400, endMs: 11600, text: "Julianna started here." },
      { speaker: "spk_2", startMs: 11700, endMs: 13000, text: "Well, what" },
    ]);
  });

  it("explains what's wrong when utterances are missing", () => {
    expect(() => parseUtterances({ results: {} })).toThrow("Deepgram response has no utterances; was utterances=true set?");
  });
});

describe("applyCorrections", () => {
  const corrections = [{ heard: "Tariq", correct: "Tarik" }, { heard: "Anne Christensen", correct: "Ann Christenson" }];

  it("rewrites known mishearings as whole words, longest first", () => {
    expect(applyCorrections("Tariq and Anne Christensen say hi to Tariq's fans.", corrections)).toBe(
      "Tarik and Ann Christenson say hi to Tarik's fans.",
    );
  });

  it("leaves words that merely contain a misheard name alone", () => {
    expect(applyCorrections("Tariqa Lane", corrections)).toBe("Tariqa Lane");
  });
});

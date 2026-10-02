import { describe, expect, it } from "vitest";
import { assignSpeakers, hostsFromShowNotes, speakerCandidates, speakerLabels, speakerQuestions } from "../../convex/lib/speakers";
import { getShowProfile } from "../../convex/lib/shows";
import { TEST_SEGMENTS } from "../fixtures/segments";

describe("hostsFromShowNotes", () => {
  it("reads the episode host line Uniquely Milwaukee puts in its show notes", () => {
    expect(hostsFromShowNotes("... radiomilwaukee.org/ourstories.#####Episode host: Paula LovoUniquely Milwaukee is supported")).toEqual(["Paula Lovo"]);
  });

  it("returns nothing when there is no host line", () => {
    expect(hostsFromShowNotes("We bid a bittersweet farewell to Café Corazón.")).toEqual([]);
  });
});

describe("speakerCandidates", () => {
  it("combines the show's hosts, a host named in the show notes, and the episode's people, without duplicates", () => {
    expect(speakerCandidates(getShowProfile("uniquely-milwaukee"), "Episode host: Kim Shine", ["Ruben Gaona", "Kim Shine"])).toEqual([
      "Kim Shine", "Ruben Gaona",
    ]);
  });

  it("treats a misheard spelling of a host as the host, keeping the correct spelling", () => {
    expect(speakerCandidates(getShowProfile("this-bites"), "", ["Tariq Moody", "Anne Christensen", "Kyle Knall"])).toEqual([
      "Tarik Moody", "Ann Christenson", "Kyle Knall",
    ]);
  });

  it("starts from the This Bites hosts", () => {
    expect(speakerCandidates(getShowProfile("this-bites"), "", [])).toEqual(["Tarik Moody", "Ann Christenson"]);
  });
});

describe("speakerLabels", () => {
  it("lists each speaker once, in order of first appearance", () => {
    expect(speakerLabels(TEST_SEGMENTS)).toEqual(["spk_0", "spk_1"]);
  });
});

describe("speakerQuestions", () => {
  it("asks one multiple-choice question per speaker, with an 'someone else' option", () => {
    const questions = speakerQuestions(["spk_0", "spk_1"], ["Tarik Moody", "Ann Christenson"]);
    expect(Object.keys(questions)).toEqual(["spk_0", "spk_1"]);
    expect(Object.keys(questions.spk_0.criteria)).toEqual(["Tarik Moody", "Ann Christenson", "someone else"]);
  });
});

describe("assignSpeakers", () => {
  it("names a speaker only when Jev is confident, and never gives two speakers the same name", () => {
    const answers = {
      spk_0: { choice: "Tarik Moody", confidence: 0.92 },
      spk_1: { choice: "Ann Christenson", confidence: 0.88 },
      spk_2: { choice: "Tarik Moody", confidence: 0.7 },
      spk_3: { choice: "Ruben Gaona", confidence: 0.4 },
      spk_4: { choice: "someone else", confidence: 0.95 },
    };
    expect(assignSpeakers(["spk_0", "spk_1", "spk_2", "spk_3", "spk_4"], answers)).toEqual([
      { label: "spk_0", name: "Tarik Moody", confidence: 0.92 },
      { label: "spk_1", name: "Ann Christenson", confidence: 0.88 },
    ]);
  });
});

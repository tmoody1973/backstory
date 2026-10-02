import { describe, expect, it } from "vitest";
import { gentleJudge, judgePeople, peopleQuestions } from "../../convex/lib/jevPeople";

const people = ["Ruben Gaona", "Devin Flores", "Kim Shine", "Bob Uecker"];

describe("peopleQuestions", () => {
  it("asks three yes/no questions about each person", () => {
    const questions = peopleQuestions(people);
    expect(Object.keys(questions)).toHaveLength(12);
    expect(questions.subject_0).toMatchObject({ type: "noul" });
    expect(JSON.stringify(questions.protected_1)).toContain("Devin Flores");
    expect(JSON.stringify(questions.host_2)).toContain("host");
  });
});

describe("judgePeople", () => {
  const answers = {
    subject_0: { noul: 0.95 }, protected_0: { noul: 0.05 }, host_0: { noul: 0.02 },
    subject_1: { noul: 0.9 }, protected_1: { noul: 0.93 }, host_1: { noul: 0.01 },
    subject_2: { noul: 0.6 }, protected_2: { noul: 0.02 }, host_2: { noul: 0.97 },
    subject_3: { noul: 0.12 }, protected_3: { noul: 0.01 }, host_3: { noul: 0.01 },
  };

  it("keeps the people the story is about or who speak for it", () => {
    expect(judgePeople(people, answers).kept).toEqual(["Ruben Gaona"]);
  });

  it("drops participants and minors, hosts, and passing mentions, with the reason", () => {
    expect(judgePeople(people, answers).dropped).toEqual([
      { name: "Devin Flores", reason: "participant, student, patient, resident or minor" },
      { name: "Kim Shine", reason: "the show's host" },
      { name: "Bob Uecker", reason: "mentioned in passing" },
    ]);
  });

  it("drops a person whose answers are missing rather than guessing", () => {
    expect(judgePeople(["Someone"], {}).dropped).toEqual([{ name: "Someone", reason: "no judgment returned" }]);
  });
});

describe("gentleJudge (decision 008)", () => {
  const answers = {
    subject_0: { noul: 0.95 }, protected_0: { noul: 0.05 }, host_0: { noul: 0.02 },
    subject_1: { noul: 0.9 }, protected_1: { noul: 0.93 }, host_1: { noul: 0.01 },
    subject_2: { noul: 0.6 }, protected_2: { noul: 0.02 }, host_2: { noul: 0.97 },
    subject_3: { noul: 0.12 }, protected_3: { noul: 0.01 }, host_3: { noul: 0.01 },
  };

  it("always removes participants, minors and hosts", () => {
    expect(gentleJudge(people, answers).dropped.map((d) => d.name)).toEqual(["Devin Flores", "Kim Shine"]);
  });

  it("keeps passing mentions, flagged with how likely they are a real subject", () => {
    expect(gentleJudge(people, answers).kept).toEqual([
      { name: "Ruben Gaona", subjectConfidence: 0.95 },
      { name: "Bob Uecker", subjectConfidence: 0.12 },
    ]);
  });

  it("removes a person it could not judge, since the privacy check did not run", () => {
    expect(gentleJudge(["Someone"], {}).dropped).toEqual([{ name: "Someone", reason: "no judgment returned" }]);
  });
});

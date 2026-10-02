import type { JevAnswer } from "./jevTopics";

/** A person is kept only when Jev is more sure than not that each condition holds. */
const THRESHOLD = 0.5;

/** Three yes/no questions per person, answered against the transcript (the request's state). */
export function peopleQuestions(names: string[]) {
  const questions: Record<string, unknown> = {};
  names.forEach((name, i) => {
    questions[`subject_${i}`] = {
      type: "noul",
      instructions: {
        person: name,
        question: "Is this person a subject of the story, or someone who speaks for it (staff, owner, chef, leader, artist, official), rather than someone mentioned in passing?",
      },
    };
    questions[`protected_${i}`] = {
      type: "noul",
      instructions: { person: name, question: "Is this person a program participant, a student, a patient, a resident of a facility, or a minor?" },
    };
    questions[`host_${i}`] = {
      type: "noul",
      instructions: { person: name, question: "Is this person one of the show's hosts or producers rather than part of the story?" },
    };
  });
  return questions;
}

export function judgePeople(names: string[], answers: Record<string, JevAnswer>) {
  const kept: string[] = [];
  const dropped: Array<{ name: string; reason: string }> = [];
  names.forEach((name, i) => {
    const subject = answers[`subject_${i}`]?.noul;
    const isProtected = answers[`protected_${i}`]?.noul;
    const host = answers[`host_${i}`]?.noul;
    if (subject === undefined || isProtected === undefined || host === undefined) {
      dropped.push({ name, reason: "no judgment returned" });
    } else if (isProtected >= THRESHOLD) {
      dropped.push({ name, reason: "participant, student, patient, resident or minor" });
    } else if (host >= THRESHOLD) {
      dropped.push({ name, reason: "the show's host" });
    } else if (subject < THRESHOLD) {
      dropped.push({ name, reason: "mentioned in passing" });
    } else {
      kept.push(name);
    }
  });
  return { kept, dropped };
}

/**
 * Decision 008: participants, students, patients, residents, minors and hosts are always removed
 * (privacy enforced in code, not left to the prompt). Everyone else is kept with Jev's probability
 * that they're a real subject, so editors can sort or hide passing mentions instead of losing them.
 */
export function gentleJudge(names: string[], answers: Record<string, JevAnswer>) {
  const kept: Array<{ name: string; subjectConfidence: number }> = [];
  const dropped: Array<{ name: string; reason: string }> = [];
  names.forEach((name, i) => {
    const subject = answers[`subject_${i}`]?.noul;
    const isProtected = answers[`protected_${i}`]?.noul;
    const host = answers[`host_${i}`]?.noul;
    if (subject === undefined || isProtected === undefined || host === undefined) {
      dropped.push({ name, reason: "no judgment returned" });
    } else if (isProtected >= THRESHOLD) {
      dropped.push({ name, reason: "participant, student, patient, resident or minor" });
    } else if (host >= THRESHOLD) {
      dropped.push({ name, reason: "the show's host" });
    } else {
      kept.push({ name, subjectConfidence: subject });
    }
  });
  return { kept, dropped };
}

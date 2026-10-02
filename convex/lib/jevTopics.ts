import { MIN_QUOTE_WORDS, normalizeForMatch, type Segment } from "./evidence";
import { TOPIC_VALUES, type Topic } from "./taxonomy";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
/** A topic must be more likely central than not. */
export const TOPIC_THRESHOLD = 0.5;
const MAX_TOPICS = 3;
/** TypeSafe allows at most 255 options per Choice. */
const MAX_PASSAGES = 255;

// The Field Guide's short names spelled out, so the model reads "arts" as "arts and culture".
const TOPIC_DESCRIPTIONS: Record<Topic, string> = {
  music: "Music: artists, songs, albums, concerts, the local music scene",
  comedy: "Comedy: comedians, stand-up, improv, humor as the subject",
  sports: "Sports: teams, athletes, games, recreation leagues",
  festival: "Festivals: multi-day or large public celebrations and fairs",
  family: "Family: kids, parenting, activities for families",
  "food-drink": "Food and drink: restaurants, chefs, dishes, bars, coffee, food events",
  arts: "Arts and culture: visual art, theater, dance, film, literature, cultural heritage",
  community: "Community: neighbors, volunteers, mutual aid, neighborhood life",
  other: "None of the listed subjects fit",
  "civic-life": "Civic life: government, justice and reentry, public policy, advocacy, public services",
  history: "History: Milwaukee's past, anniversaries, legacies of people and places",
  education: "Education: schools, training programs, youth and adult learning",
  business: "Business: openings, closings, owners, jobs, the local economy",
};

export interface Candidate {
  id: string;
  text: string;
  startMs: number;
  speaker: string;
}

/** One answer from TypeSafe: a Noul carries `noul`, a Choice carries `choice`, `confidence` and `probabilities`. */
export interface JevAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface PickedTopic {
  topic: Topic;
  confidence: number;
}

export function transcriptState(segments: Segment[]): string {
  return segments.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n");
}

export function topicQuestions() {
  return Object.fromEntries(
    TOPIC_VALUES.map((topic) => [
      topic,
      {
        type: "noul" as const,
        instructions: {
          topic: TOPIC_DESCRIPTIONS[topic],
          question: "Is this topic one of the main subjects of this podcast episode, not just a passing mention?",
        },
        criteria: {
          true: "A main subject the episode spends real time on",
          false: "Absent, or only mentioned in passing",
        },
      },
    ]),
  );
}

/** Up to three vocabulary topics above the threshold, most likely first. */
export function pickTopics(answers: Record<string, JevAnswer>): PickedTopic[] {
  return TOPIC_VALUES.flatMap((topic) => {
    const confidence = answers[topic]?.noul;
    return confidence !== undefined && confidence >= TOPIC_THRESHOLD ? [{ topic, confidence }] : [];
  })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TOPICS);
}

/**
 * Transcript passages a topic's quote can be chosen from. Neighbouring segments are merged
 * (before short ones are dropped, so every candidate stays contiguous transcript text) until
 * they fit in one Choice.
 */
export function passageCandidates(segments: Segment[], excludeNames: string[] = []): Candidate[] {
  const excluded = excludeNames.map(normalizeForMatch).filter(Boolean);
  const namesExcluded = (text: string) => {
    const padded = ` ${normalizeForMatch(text)} `;
    return excluded.some((name) => padded.includes(` ${name} `));
  };
  let passages = segments.map(({ text, startMs, speaker }) => ({ text, startMs, speaker }));
  while (passages.length > MAX_PASSAGES) {
    const merged = [];
    for (let i = 0; i < passages.length; i += 2) {
      const next = passages[i + 1];
      merged.push(next ? { ...passages[i], text: `${passages[i].text} ${next.text}` } : passages[i]);
    }
    passages = merged;
  }
  return passages
    .filter((passage) => passage.text.split(/\s+/).filter(Boolean).length >= MIN_QUOTE_WORDS)
    .filter((passage) => !namesExcluded(passage.text))
    .map((passage, index) => ({ id: `p${index}`, ...passage }));
}

export function evidenceQuestions(topics: PickedTopic[], candidates: Candidate[]) {
  const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.text]));
  return Object.fromEntries(
    topics.map(({ topic }) => [
      topic,
      {
        type: "choice" as const,
        instructions: {
          topic: TOPIC_DESCRIPTIONS[topic],
          question: "Which passage from this podcast episode best shows that the episode is about this topic?",
        },
        criteria,
      },
    ]),
  );
}

/** The chosen passage, copied exactly, becomes the topic's quote. */
export function pickEvidence(
  topics: PickedTopic[],
  answers: Record<string, JevAnswer>,
  candidates: Candidate[],
) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return topics.flatMap(({ topic, confidence }) => {
    const passage = byId.get(answers[topic]?.choice ?? "");
    return passage ? [{ topic, confidence, quote: passage.text, startMs: passage.startMs, speaker: passage.speaker }] : [];
  });
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

/** One TypeSafe evaluation. Errors throw, so a pipeline step fails and goes through its normal retries. */
export async function askJev(
  state: string,
  questions: Record<string, unknown>,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JevResponse> {
  const response = await fetchImpl(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: JEV_MODEL, questions }),
  });
  if (!response.ok) throw new Error(`TypeSafe request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as JevResponse;
}

const PASSAGE_TRIES = 3;

/** The top passages Jev chose for a topic, most likely first. */
function rankedPassages(answer: JevAnswer | undefined, byId: Map<string, Candidate>): Candidate[] {
  const ids = answer?.probabilities
    ? Object.entries(answer.probabilities).sort(([, a], [, b]) => b - a).map(([id]) => id)
    : answer?.choice ? [answer.choice] : [];
  return ids.flatMap((id) => byId.get(id) ?? []).slice(0, PASSAGE_TRIES);
}

/**
 * Decision 007: Jev picks up to three topics, then the transcript passage that supports each one.
 * Decision 008: a passage that names a participant, student, patient, resident or minor is never
 * used as a quote; the next-best passage is tried, and a topic with no clean passage is dropped.
 */
export async function jevTopicsFor(
  input: { title: string; segments: Segment[] },
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  excludeNames: string[] = [],
) {
  const topicRun = await askJev(transcriptState(input.segments), topicQuestions(), apiKey, fetchImpl);
  const topics = pickTopics(topicRun.answers);
  if (topics.length === 0) return [];
  const candidates = passageCandidates(input.segments, excludeNames);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const state = `Podcast episode: "${input.title}"`;
  const evidenceRun = await askJev(state, evidenceQuestions(topics, candidates), apiKey, fetchImpl);
  const ranked = topics.map((topic) => ({ ...topic, passages: rankedPassages(evidenceRun.answers[topic.topic], byId) }));
  const privacyQuestions = Object.fromEntries(
    ranked.flatMap(({ topic, passages }) =>
      passages.map((passage, rank) => [
        `${topic}__${rank}`,
        {
          type: "noul",
          instructions: {
            passage: passage.text,
            question: "Does this passage name, by name, a program participant, a student, a patient, a resident of a facility, or a minor?",
          },
        },
      ]),
    ),
  );
  const privacyRun = await askJev(state, privacyQuestions, apiKey, fetchImpl);
  return ranked.flatMap(({ topic, confidence, passages }) => {
    const clean = passages.find((_, rank) => (privacyRun.answers[`${topic}__${rank}`]?.noul ?? 1) < 0.5);
    return clean ? [{ topic, confidence, quote: clean.text, startMs: clean.startMs, speaker: clean.speaker }] : [];
  });
}

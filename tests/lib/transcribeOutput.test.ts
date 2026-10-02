import { describe, expect, it } from "vitest";
import { parseTranscribeOutput, shouldStartNewTranscription } from "../../convex/lib/transcribeOutput";
import fixture from "../fixtures/transcribe-output.json";

describe("parseTranscribeOutput", () => {
  it("turns audio segments into speaker-labeled segments in milliseconds", () => {
    expect(parseTranscribeOutput(fixture)).toEqual([
      { speaker: "spk_0", startMs: 540, endMs: 2100, text: "Welcome back to This Bites." },
      { speaker: "spk_1", startMs: 2300, endMs: 6850, text: "We bid a bittersweet farewell to Café Corazón in Bay View." },
    ]);
  });

  it("explains what is wrong when speaker segments are missing", () => {
    expect(() => parseTranscribeOutput({ results: { transcripts: [] } })).toThrow(
      "Transcribe output has no audio_segments; was ShowSpeakerLabels on?",
    );
  });
});

describe("shouldStartNewTranscription", () => {
  it("starts when there is no earlier Transcribe job", () => {
    expect(shouldStartNewTranscription(null)).toBe(true);
  });

  it("starts again only when the earlier job failed", () => {
    expect(shouldStartNewTranscription("FAILED")).toBe(true);
  });

  it("resumes a job that is queued, running, or already finished instead of paying twice", () => {
    expect(["QUEUED", "IN_PROGRESS", "COMPLETED"].map(shouldStartNewTranscription)).toEqual([false, false, false]);
  });
});

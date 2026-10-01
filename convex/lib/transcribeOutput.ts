import type { Segment } from "./evidence";

interface AudioSegment {
  transcript: string;
  start_time: string;
  end_time: string;
  speaker_label?: string;
}

const toMs = (seconds: string) => Math.round(Number.parseFloat(seconds) * 1000);

export function parseTranscribeOutput(json: unknown): Segment[] {
  const segments = (json as { results?: { audio_segments?: AudioSegment[] } })?.results?.audio_segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("Transcribe output has no audio_segments; was ShowSpeakerLabels on?");
  }
  return segments
    .filter((segment) => segment.transcript.trim())
    .map((segment) => ({
      speaker: segment.speaker_label ?? "spk_0",
      startMs: toMs(segment.start_time),
      endMs: toMs(segment.end_time),
      text: segment.transcript.trim(),
    }));
}

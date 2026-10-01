"use node";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetTranscriptionJobCommand, StartTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { runStep, stepArgs } from "../lib/steps";
import { parseTranscribeOutput, shouldStartNewTranscription } from "../lib/transcribeOutput";

const POLL_EVERY_MS = 60_000;
const MAX_POLLS = 90; // a 30-minute episode normally finishes well inside 15

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Convex env var ${name}`);
  return value;
}

const transcriptKey = (storyId: string) => `transcripts/${storyId}.json`;

export const start = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.aws.transcribe.start, async () => {
      const region = requireEnv("AWS_REGION");
      const bucket = requireEnv("BACKSTORY_S3_BUCKET");
      const transcribe = new TranscribeClient({ region });
      const earlierJob = await ctx.runQuery(internal.transcripts.existingJobName, { jobId: args.jobId });
      const earlierStatus = earlierJob
        ? ((await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: earlierJob }))).TranscriptionJob
            ?.TranscriptionJobStatus ?? "FAILED")
        : null;
      if (!shouldStartNewTranscription(earlierStatus)) {
        await ctx.scheduler.runAfter(0, internal.aws.transcribe.poll, { ...args, polls: 1 });
        return;
      }
      const { audioUrl } = await ctx.runQuery(internal.transcripts.audioFor, { storyId: args.storyId });
      const audio = await fetch(audioUrl); // Podtrac redirects to the PRX file; fetch follows redirects
      if (!audio.ok) throw new Error(`Audio download failed: HTTP ${audio.status} for ${audioUrl}`);
      const audioKey = `audio/${args.storyId}.mp3`;
      await new S3Client({ region }).send(
        new PutObjectCommand({ Bucket: bucket, Key: audioKey, Body: Buffer.from(await audio.arrayBuffer()), ContentType: "audio/mpeg" }),
      );
      const jobName = `backstory-${args.storyId}-${Date.now()}`;
      const vocabulary = process.env.TRANSCRIBE_VOCABULARY_NAME;
      await transcribe.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          LanguageCode: "en-US",
          MediaFormat: "mp3",
          Media: { MediaFileUri: `s3://${bucket}/${audioKey}` },
          OutputBucketName: bucket,
          OutputKey: transcriptKey(args.storyId),
          Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 6, ...(vocabulary ? { VocabularyName: vocabulary } : {}) },
        }),
      );
      await ctx.runMutation(internal.transcripts.markTranscribing, { ...args, externalId: jobName });
      await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.aws.transcribe.poll, { ...args, polls: 1 });
    });
  },
});

export const poll = internalAction({
  args: { ...stepArgs, polls: v.number() },
  handler: async (ctx, { polls, ...args }) => {
    // A failed poll retries through `start`, which resumes the existing job unless Transcribe marked it FAILED.
    await runStep(ctx, args, internal.aws.transcribe.start, async () => {
      const region = requireEnv("AWS_REGION");
      const bucket = requireEnv("BACKSTORY_S3_BUCKET");
      const { externalId } = await ctx.runQuery(internal.transcripts.jobExternalId, { jobId: args.jobId });
      const { TranscriptionJob: job } = await new TranscribeClient({ region }).send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: externalId }),
      );
      const status = job?.TranscriptionJobStatus;
      if (status === "FAILED") throw new Error(`Transcribe failed: ${job?.FailureReason ?? "no reason given"}`);
      if (status !== "COMPLETED") {
        if (polls >= MAX_POLLS) throw new Error(`Transcribe still ${status} after ${MAX_POLLS} polls`);
        await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.aws.transcribe.poll, { ...args, polls: polls + 1 });
        return;
      }
      const key = transcriptKey(args.storyId);
      const object = await new S3Client({ region }).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!object.Body) throw new Error(`Transcript ${key} is empty`);
      const segments = parseTranscribeOutput(JSON.parse(await object.Body.transformToString()));
      await ctx.runMutation(internal.transcripts.save, { ...args, ref: `s3://${bucket}/${key}`, segments });
    });
  },
});

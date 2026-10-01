import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// PRD Operations: check CDS daily for new episodes (12:00 / 12:15 UTC, 7 a.m. Milwaukee).
// Upserts are idempotent, so overlapping runs are harmless.
crons.cron("ingest This Bites", "0 12 * * *", internal.ingest.ingestShow, { showSlug: "this-bites", limit: 10 });
crons.cron("ingest Uniquely Milwaukee", "15 12 * * *", internal.ingest.ingestShow, { showSlug: "uniquely-milwaukee", limit: 10 });

export default crons;

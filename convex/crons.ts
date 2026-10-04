import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// PRD Operations: check CDS daily for new episodes (12:00 / 12:15 UTC, 7 a.m. Milwaukee).
// Upserts are idempotent, so overlapping runs are harmless.
crons.cron("ingest This Bites", "0 12 * * *", internal.ingest.ingestShow, { showSlug: "this-bites", limit: 10 });
crons.cron("ingest Uniquely Milwaukee", "15 12 * * *", internal.ingest.ingestShow, { showSlug: "uniquely-milwaukee", limit: 10 });
crons.cron("ingest Ladies First", "30 12 * * *", internal.ingest.ingestShow, { showSlug: "ladies-first", limit: 10 });
crons.cron("ingest Milwaukee Music Premiere", "45 12 * * *", internal.ingest.ingestShow, { showSlug: "milwaukee-music-premiere", limit: 10 });
crons.cron("ingest Studio Milwaukee Sessions", "0 13 * * *", internal.ingest.ingestShow, { showSlug: "studio-milwaukee", limit: 10 });

// An action that dies outside its error handler (timeout, deploy mid-run) never reports failure;
// the sweeper sends such jobs through the normal retry → needs_editor path.
crons.interval("sweep stale jobs", { minutes: 15 }, internal.jobs.sweepStale, {});

export default crons;

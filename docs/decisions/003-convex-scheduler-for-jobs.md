# 003: Pipeline jobs run on Convex's scheduler, not Trigger.dev

**Decision:** Each pipeline step is a Convex action, scheduled by Convex and tracked in a `jobs` table with retries.

**Why this came up:** The PRD says to reuse the Field Guide's job and backoff patterns; the Field Guide runs jobs on Trigger.dev against Neon. Backstory's data is in Convex.

**Options:**
- Convex scheduler + `jobs` table. One system; a step's output and its job status save in the same transaction.
- Trigger.dev, like the Field Guide. Better run dashboards and long-running tasks, but a second service writing into Convex over the network.
- A worker on the Hetzner box. Full control, but we'd own uptime.

**What we chose and why:** Convex scheduler (Claude, accepted with this plan). At one episode a week the simplest system wins, and saving data and finishing a job in one transaction means a crash can't leave them disagreeing.

**What we gave up:** Convex Node actions time out at 10 minutes, so Transcribe is polled once a minute instead of awaited, and there's no dedicated job dashboard beyond the `jobs` table.

**How we'll know if this was right:** The 10-episode hackathon run finishes with no job stuck in `running`, and any `needs_editor` story has a readable `lastError`.

**What actually happened:**

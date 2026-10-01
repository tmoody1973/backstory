# 002: Transcribe every episode; show notes are never evidence

**Decision:** Every audio episode goes through Amazon Transcribe. The show notes in CDS are passed to the model only to help it spell names, and nothing can be quoted from them.

**Why this came up:** The PRD planned to use a CDS transcript "when present." Checking a real This Bites document showed CDS has show notes and an MP3, but no transcript, and Tarik confirmed that's true across the station.

**Options:**
- Transcribe everything. Costs about $0.024 a minute (roughly $5 for 10 episodes) and every quote is checkable.
- Extract from show notes when they're detailed. Free, but show notes are written about the episode, not said in it, so "verbatim quote" would stop meaning anything.
- Mix the two, marking show-note facts as lower confidence. Two evidence standards for editors to keep straight.

**What we chose and why:** Transcribe everything (Tarik). The engine's promise is that every detail traces to something actually said on air.

**What we gave up:** Transcription cost and about 10–15 minutes per episode before it's ready for review. Backfilling the ~377 This Bites episodes will cost real money (see the PRD's budget question).

**How we'll know if this was right:** On the 20-episode labeled set, 100% of kept quotes are found in transcripts and editors rarely add a fact the pipeline missed because it was only in the show notes.

**What actually happened:**

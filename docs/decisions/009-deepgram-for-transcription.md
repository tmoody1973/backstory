# 009: Deepgram Nova-3 replaces Amazon Transcribe for transcription

**Decision:** Episodes are transcribed by Deepgram Nova-3. Amazon Transcribe stays available as a fallback setting (`TRANSCRIBER=transcribe`).

**Why this came up:** Names are the heart of Backstory: people and places a listener can ask Alexa about. Transcribe kept mishearing them ("Tariq", "Galona", "Emmy's", "Esterov"). A custom vocabulary fixed known names, but only after someone corrected them by hand.

**Options:**
- Keep Transcribe and keep growing the vocabulary. All-AWS, already built; every new guest name still needs a human correction first.
- Deepgram Nova-3. Took the same per-episode name hints and spelled 84% of answer-key names right vs Transcribe's 74% across 19 episodes, equal or better on every one. Listed at $0.0043/min vs Transcribe's $0.024/min (about 5.5x cheaper; add-on pricing for speaker separation and hints not confirmed). Fetches audio straight from its URL, so no S3 copy.
- Run both and pick per episode. Most accurate in theory, double the cost and code.

**What we chose and why:** Deepgram (Tarik, 2026-10-01, after a bake-off he asked to widen from 5 to 19 episodes). Better first-pass names, cheaper backfill, simpler pipeline. Numbers: `docs/eval/results-2026-10-01.md`.

**What we gave up:** This step leaves AWS, weakening the all-AWS hackathon story; a third AI vendor and key in the pipeline; Deepgram's speaker separation and name hints (500-token limit per request) work differently from Transcribe's, and E06 (56 minutes) was not in the bake-off.

**How we'll know if this was right:** On the next labeled batch, Deepgram keeps a 5+ point lead on names, and the "misheard => correct" list grows more slowly than it did with Transcribe.

**What actually happened:**

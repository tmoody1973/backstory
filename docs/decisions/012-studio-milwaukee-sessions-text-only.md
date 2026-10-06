# 012 — Studio Milwaukee Sessions are read as text, never transcribed

**Decision** — Backstory reads each Studio Milwaukee Session from its article text and set list in CDS (the NPR content system the station publishes to); it never downloads or transcribes the session audio, and Alexa links to the session page on radiomilwaukee.org instead of playing it.

**Why this came up** — The PRD planned to transcribe sessions (about 25 minutes each) and keep only the interview parts. Checking CDS on 2026-10-04 showed two problems: the recording is one continuous file with no marks for where songs start and stop, and its rights flags say "not downloadable, not embeddable" — unlike our podcasts, which are downloadable and embeddable. The songs are other artists' music, so getting this wrong is a licensing problem, not just a quality one.

**Options**
- *Transcribe and cut out the songs* — the artist's own words in quotes; costs transcription for 24 sessions, needs software to tell music from speech (untested), and goes against the "not downloadable" flag.
- *Text only, link to the page* — no audio handling at all; loses the interview quotes that only exist in the audio.
- *Ask the station for permission first, then decide* — safest on rights, but leaves the music slice waiting on someone else before the Oct 23 deadline.

**What we chose and why** — Text only (Tarik). The article already says who played, when, what they talked about, and the set list; that is enough for "tell me about the Tank & The Bangas session" and for linking artists in rotation to sessions, with no rights question.

**What we gave up** — Quotes in the artist's own voice from the interviews, and playing sessions on Echo Show. If those matter later, they need the station's go-ahead on the audio rights first.

**How we'll know if this was right** — Alexa can answer session questions (who, when, what they played, what they talked about) from the article alone in the music-slice tests, and no listener-facing answer needs the audio.

**What actually happened** —

# Learning log

Dated entries: what we expected, what happened, what we now believe.

## 2026-10-01 — First live run, Nova Micro, 1 episode per show

**What we expected:** Nova Micro would extract the people, places and actions in each episode with verbatim quotes, and most places would pin.

**What happened (numbers from the Convex tables and the extraction logs):**

| Run | Show | Mentions kept | Mentions dropped | Actions kept / dropped | Places pinned / total |
|---|---|---|---|---|---|
| 1 (original prompt) | Uniquely Milwaukee | 1 (a URL) | 3 | 1 / 0 | 0 / 1 |
| 1 (original prompt) | This Bites | 6 | 2 | 3 / 0 | 0 / 3 |
| 2 (prompt + filters fixed) | Uniquely Milwaukee | 3 | 1 | 1 / 0 | 1 / 1 |
| 2 (prompt + filters fixed) | This Bites | 6 | 1 | 0 / 3 | 0 / 1 |

- Transcribe misspelled a guest ("Ruben Galona"); the model "corrected" the quote from the show notes, so the evidence check dropped him until the prompt said to keep the transcript's spelling.
- Every dropped This Bites action in run 2 was a paraphrase, not a copy, of what was said.
- No place was ever pinned wrongly; Café Corazón was correctly held back because it has three locations.
- Run 2 extracted a Community Reintegration Center resident by first name.

**What we now believe:**

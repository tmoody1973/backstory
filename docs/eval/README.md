# Labeled evaluation set

20 hand-labeled episodes (10 This Bites, 10 Uniquely Milwaukee) used to score extraction models against the PRD targets: topic agreement ≥85%, places ≥95% correct. Ladies First's 4 episodes join when it is onboarded (MOO-854).

- `labeled-set-episodes.json`: the 20 episodes, chosen for spread (long and short, older and newer, sensitive stories, misheard names), not recency.
- `labeling-guide.md`: instructions for labelers. Labels are made blind: labelers never see model output first.
- `pool-sources.json`: which model proposed each suggestion (hidden from labelers; used only for scoring).
- `transcript-doc-ids.json`: the Google Doc holding each episode's show notes + transcript.
- Method: 15 episodes reviewed from pooled, unattributed Haiku + Jev suggestions plus a "what's missing" pass; 5 short episodes (E13, E14, E15, E17, E20) labeled blind as a control.
- Labeling happens in Google Drive, folder "Backstory labeled set" (Episodes and Labels sheets, guide). Finished labels are copied back here as the regression set.

## Not in the public repo

The labeled answer key, the human and AI label files, the raw model outputs and the links to the source transcripts were removed before this repo was made public: they name private individuals (residents, family members, first-name-only guests) alongside public figures. The method, the labeling guide, the episode list and the scored results remain. The scoring scripts expect those files and won't run without them.

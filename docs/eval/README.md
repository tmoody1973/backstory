# Labeled evaluation set

20 hand-labeled episodes (10 This Bites, 10 Uniquely Milwaukee) used to score extraction models against the PRD targets: topic agreement ≥85%, places ≥95% correct. Ladies First's 4 episodes join when it is onboarded (MOO-854).

- `labeled-set-episodes.json`: the 20 episodes, chosen for spread (long and short, older and newer, sensitive stories, misheard names), not recency.
- `labeling-guide.md`: instructions for labelers. Labels are made blind: labelers never see model output first.
- Labeling happens in Google Drive, folder "Backstory labeled set" (Episodes and Labels sheets, guide). Finished labels are copied back here as the regression set.

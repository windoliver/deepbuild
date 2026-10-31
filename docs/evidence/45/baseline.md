# Decision 1 baseline and agreement threshold (#45)

Fixed by the owner on 2026-10-31, before the dogfood week. The values stay private; only their hash is here.

| | |
|---|---|
| Baseline hash | `7256cd7d811c0f07421445bbe03ef466972199b0e19cd1b5668a672e8de07f24`, the SHA-256 of the private `numbers.json` |
| Window | 2026-10-15 to 2026-10-27, whole UTC days |
| Source | This repo's Claude Code transcripts, counted by the `@deepbuild/readings` classifiers |
| Classifiers | `is_it_done`, `rework` |
| Agreement threshold | 0.8 for each classifier |
| Labelling cutoff | The dogfood week's first day |

**This isn't an earlier pilot.** The design names the pilot's values as the baseline, and no pilot was run. This baseline was recomputed from the two weeks before the dogfood week, and it covers Claude Code only.

Its numbers were computed by the agent and, like every count here, aren't yet checked against labels. The classifiers count nothing for Decision 1 until a person labels at least 100 messages per classifier and each reaches the threshold (AC4).

# 0011: The work a budget's run reports

Status: accepted (#3537). The design states the rule these serve under Numbers version 0 has to hold (a gain is judged on the same work) and in `docs/parallel-proof.md`, section 12a (Work); the report's field, the row's and the record's fields and the approval's item are in `tests/acceptance/3537/README.md`. The decisions below are the ones written nowhere else.

## What a side's work is

- **A report with no `work` key reports none, and `work` with no counts or a count that is no number can't be read.** `scripts/benchmark.mjs`, `workOf`. A run that prints no report reports none too. The two are kept apart: a task that reports none is compared as before and listed, and one that can't be read is missing.
- **A side's work is what every one of its runs reports.** `scripts/benchmark.mjs`, `workOfRuns`. Runs of one side that report unlike counts leave the side with work that can't be read, so a count that moves from run to run is no `work`.

## What two sides read

- **A benchmark's first report is compared as before.** `scripts/benchmark.mjs`, `judgeWork`. Where the merge base's runs report no `work` and the change's do, there is nothing to hold the change to, so the task is judged as it was before #3537 and the record doesn't list it under `noWork`. Every task gains its line in some later change. A window never measures a commit twice, so reading each such commit INCONCLUSIVE would leave it unmeasured for good, and a slowdown landed with the line would read INCONCLUSIVE where it reads FAIL today. That commit can't lower a ceiling: the merge base's runs report nothing its runs could match.
- **A change that stops reporting is missing.** `scripts/benchmark.mjs`, `judgeWork`. Where the merge base's runs report `work` and the change's report none, the task is INCONCLUSIVE, as for work that can't be read, so taking the line out is no way to do less.
- **A count only one side reports is unlike.** `scripts/benchmark.mjs`, `judgeWork`. Its value on the other side reads `none`, in the row's note and in the approval's item, as a removed limit does (#2665).
- **Unlike sides aren't compared at all.** `scripts/benchmark.mjs`, `judgeTask`. While the work reads INCONCLUSIVE the task has no merge-base regression and no instructions verdict, a rise included, as the preflight workload makes no comparison between sides that read unlike kept results. Its limits and targets are judged as they are: each is held on the change's own runs.

## A lowered ceiling

- **A refused lowering is BLOCKED on the task's own row.** `scripts/benchmark.mjs`, `refusedLowering`. The task has to run before its runs' work is known, so the refusal can't come from `validateBudgets`, which refuses before anything runs. It reads BLOCKED, as that refusal does, and names the task, the ceiling's two values and what each side's runs report. The record's `lowered` still lists the ceiling the commit moved. No approval lifts it: an approved proposal lets unlike work be compared, never written down as a ceiling.
- **The runs are the ones the ceiling is judged on.** `scripts/benchmark.mjs`, `refusedLowering`. An `instructions` ceiling is judged on the change's 20 rounds, any other on the five runs after warm-up, and those are the runs whose work must be the merge base's.

## What the record lists

- **A fall is the change's value under half the merge base's.** `scripts/budget-window.mjs`, `fallsOf`. It reads the four numbers a row keeps for each side: p50, p95, peak bytes, and the median of the rounds' instructions retired, which has no value while any round's count is missing.

## The two evidence tasks

- **`evidence-put-5mb` reports the size the store holds for the put, read back by its hash, never the bytes.** `benchmarks/evidence.mjs`, `put-5mb`. Reading the bytes back hashes 5 MB again. Measured on 2026-11-27 on a Mac17,10 with `/usr/bin/time -l`, ten runs each, the task retired a median of 501.9 million instructions as it was, 508.9 million with the size read from the store and its report printed, and 522.0 million with the bytes read back, 4% more. The window fails a rise above 2% against the merge base, so the report itself would have read as a regression.

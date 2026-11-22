# DeepBuild technical design

A planted wrong program for #1111.10d60f7c (tests/acceptance/1111-redraft-2047), standing in for the whole design: the
budget line names the scheduled budget window but still says budgets are measured in the local preflight.

## How we know version 0 works

**Every task carries its own budgets.** Each issue's acceptance criteria name its time (p50 and p95), its memory (peak and idle) and, where they apply, GPU time, disk and plan share, measured on a reference Mac by a benchmark in the local preflight and again in the scheduled budget window (see [Parallel proof](./parallel-proof.md)), and compared with the merge base.

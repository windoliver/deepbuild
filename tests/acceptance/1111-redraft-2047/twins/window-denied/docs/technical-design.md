# DeepBuild: technical design

A planted wrong program for #1111 (twin `window-denied`), never a design: the new words are there, saying the opposite.

## Numbers version 0 has to hold

**Every task carries its own budgets.** Each issue's acceptance criteria name its time (p50 and p95), its memory (peak and idle) and, where they apply, GPU time, disk and plan share, measured on a reference Mac by a benchmark in the local preflight, never in the scheduled budget window (see [Budget windows](./parallel-proof.md#12a-budget-windows-owner-decision-2026-11-02)), and compared with the merge base. Each side takes 20 samples.

Budgets, timing checks and GPU work run on a reference Mac (see [Parallel proof](./parallel-proof.md)).

# DeepBuild: technical design

A planted wrong program for #1111 (twin `both-statements`), never a design: the new statement is added and the old one left standing.

## Numbers version 0 has to hold

**Every task carries its own budgets.** Each issue's acceptance criteria name its time (p50 and p95), its memory (peak and idle) and, where they apply, GPU time, disk and plan share, measured on a reference Mac by a benchmark in the local preflight, and compared with the merge base. From the owner's decision of 2026-11-02, time and memory budgets are measured on a reference Mac by a benchmark in the scheduled budget window (see [Budget windows](./parallel-proof.md#12a-budget-windows-owner-decision-2026-11-02)). Each side takes 20 samples.

Budgets, timing checks and GPU work run on a reference Mac (see [Parallel proof](./parallel-proof.md)).

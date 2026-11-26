# DeepBuild: technical design

A planted wrong program for #1111 (twin `release-preflight`), never a design: the old statement is gone, and nothing says the scheduled budget window measures budgets.

## Numbers version 0 has to hold

**Every task carries its own budgets.** Each issue's acceptance criteria name its time (p50 and p95), its memory (peak and idle) and, where they apply, GPU time, disk and plan share, measured on a reference Mac by a benchmark in the release preflight, and compared with the merge base. Each side takes 20 samples.

Budgets, timing checks and GPU work run on a reference Mac (see [Parallel proof](./parallel-proof.md)).

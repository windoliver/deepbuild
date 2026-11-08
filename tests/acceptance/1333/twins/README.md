# Twins for the 1333 tests

The base has no job, so every test fails there on a missing script, and that proves little about what the tests can
catch. These are planted wrong programs, each a plausible way to fake one criterion. `../twins.json` names them.

The blind job built them on its own throwaway implementation, which isn't kept: a `scripts/main-watch.mjs` of about
180 lines, a `scripts/known-failures-check.mjs` of about 20, the lint lane in `scripts/lanes.mjs` given
`[process.execPath, 'scripts/known-failures-check.mjs']`, and each `failures` entry of `known-failures.json` given
` (#1333, added 2026-11-07)`. That implementation passes all 8 tests. Each twin is a copy of one of its files with one
fault planted, and replaces only that file, never a test or helper. A copy goes stale as the real file changes, and
still holds its fault. The implementing job can plant the same faults in its real code under the same names.

To run one: put the implementation in a scratch tree beside this suite, copy `twins/<name>/scripts/` over its
`scripts/`, and run the test file the table names.

| Criterion | Twin | Replaces | The planted fault | Test file |
|---|---|---|---|---|
| `#1333.f14d14bc` (AC1) | `red-only` | `main-watch.mjs` | It reports that main is red, and pauses, and names no landing | `watch.test.mjs` |
| `#1333.f14d14bc` (AC1) | `blames-head` | `main-watch.mjs` | It names main's newest landing, whatever the bisection found | `watch.test.mjs` |
| `#1333.f14d14bc` (AC1) | `never-pauses` | `main-watch.mjs` | `status` always reads open | `watch.test.mjs` |
| `#1333.f14d14bc` (AC1) | `whole-lanes-bisect` | `main-watch.mjs` | It bisects with the whole unit and lint lanes, not the failing test alone | `watch.test.mjs` |
| `#1333.747cd5ee` (AC2) | `unverified-revert` | `main-watch.mjs` | It lands the revert without running anything on it | `watch.test.mjs` |
| `#1333.747cd5ee` (AC2) | `stays-paused` | `main-watch.mjs` | Landings stay paused after the revert lands | `watch.test.mjs` |
| `#1333.747cd5ee` (AC2) | `no-reopen` | `main-watch.mjs` | The landing's issue stays closed | `watch.test.mjs` |
| `#1333.aded8275` (AC3) | `flaky-holds` | `main-watch.mjs` | A new failure is never run again, so a flaky test reads as one that holds | `flaky.test.mjs` |
| `#1333.aded8275` (AC3) | `unfiled` | `main-watch.mjs` | A flaky test reads INCONCLUSIVE and is filed nowhere | `flaky.test.mjs` |
| `#1333.ed47bc1a` (AC4) | `asks-on-conflict` | `main-watch.mjs` | It asks as soon as the revert conflicts, before the attempt | `conflict.test.mjs` |
| `#1333.ed47bc1a` (AC4) | `asks-every-tick` | `main-watch.mjs` | Each tick while main stays red after the attempt asks again | `conflict.test.mjs` |
| `#1333.ed47bc1a` (AC4) | `no-attempt` | `main-watch.mjs` | A conflicting revert goes straight to an ask, with no attempt | `conflict.test.mjs` |
| `#1333.87ce4575` (AC5) | `issue-named-only` | `known-failures-check.mjs` | An entry passes once it names any issue, open or not | `known-failures.test.mjs` |
| `#1333.87ce4575` (AC5) | the base's `scripts/lanes.mjs` (no copy kept) | `lanes.mjs` | The lint lane doesn't run the check | `known-failures.test.mjs` |
| `#1333.6c0af23f` (AC6) | `asks-a-model` | `main-watch.mjs` | It asks `claude -p` to summarize the failure | `watch.test.mjs` |
| `#1333.6c0af23f` (AC6) | `dispatches-ci` | `main-watch.mjs` | It runs `gh workflow run unit.yml` on the revert's branch | `watch.test.mjs` |
| Scope: the schedule | `every-tick` | `main-watch.mjs` | Every tick runs the lanes | `schedule.test.mjs` |
| Scope: 14 days | `no-age` | `known-failures-check.mjs` | An entry passes however long ago it was added | `known-failures.test.mjs` |

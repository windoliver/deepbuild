# Blind redraft of #1018 AC6: carrying a result across sessions adds under 5 ms at p95

AC6 `#1018.e558130f`: "**Budgets,** on the reference Mac in the local preflight, compared with the merge base: with
10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim's verdict." Written from the issue,
the design and base `69803b94`. It never saw an implementation of #1018; none was in the checkout.

## What it read

- Issue #1018 as of 2026-11-03T10:02:48Z (Scope, the six criteria, Proof, Depends on).
- `docs/technical-design.md`: How runs become one of five verdicts (Pinned to a commit: the key and "a result carried
  from an earlier commit shows as carried"; Speed claims name their baseline: both sides on one machine in one run);
  Numbers version 0 has to hold (Every task carries its own budgets: five runs after warm-up, PASS, FAIL, INCONCLUSIVE
  and the margin; The reference Macs). AGENTS.md.
- At the base: `packages/hub/src/gate-runner.ts` (`stop`, `verdictOf`) and `packages/hub/src/core.ts` (`judging`, which
  appends `claim.made` at a judged stop; `runClaim`; `judged`, which records `verdict.made`; `runStart`), to learn which
  record events a claim and its verdict leave; `packages/verdicts/src/record.ts` (`recordVerdict`);
  `packages/gate/src/checkouts.ts` (`runClaim`'s within-session carry, read for the word "carried" only);
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`); `scripts/perf.mjs` (how the merge base is copied and built);
  `scripts/proof-change.mjs` (the criterion tag).
- For conventions and helpers: `tests/acceptance/824/redraft-ac1` (this README's shape), `tests/acceptance/29`
  (`h-d.ts`, `fixtures/agent.mjs`, `budgets.test.ts`), `tests/acceptance/965` (driving claims through a real hub),
  `tests/acceptance/31/budgets.test.ts`, `tests/acceptance/761/budgets.test.ts` and `tests/acceptance/185/helpers.ts`
  (the merge base exported by `git archive`).

## How to run

Node 24.22 first on `PATH`, on a reference Mac, on mains, at a 1-minute load no higher than its core count, with
`origin/main` fetched so the merge base resolves:

```sh
npm ci && npm run build --workspaces && cargo build -p deep-hook
npx vitest run --root tests/acceptance/1018/redraft-ac6 --disable-console-intercept --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/1018/redraft-ac6/tsconfig.json
```

One test, allowed four hours. The first run also exports the merge base into
`target/acceptance-1018-ac6-base/<sha>` and builds it there (`npm ci`, `npm run build --workspaces`,
`cargo build -p deep-hook`); later runs reuse it. It starts two hubs, one per side, each with its own home and repository
under `/tmp/dh29-*`, removed after; every process it starts is stopped by its PID. Nothing needs the network, a model or
a sign-in. Keep the console output: the readings printed there are the criterion's proof. It belongs on the
one-at-a-time line of the budget window (`scripts/lanes.mjs`'s `alone` list): anything beside it moves its timings.
With `--root`, Vitest writes `node_modules/.vite/` in this folder; delete it before committing.

## Expected values

| | Value |
|---|---|
| Limit | under 5 ms added at p95, per run: this side's p95 less the merge base's, over the same claims |
| Keys kept before measuring | at least 10,000 passed results of distinct (check, snapshot) on each side |
| Runs | five after a warm-up of 20 pairs, 200 pairs a run, so a p95 is the 190th of 200 |
| Judge | `judgeLimit`: PASS when all five are at most 5 ms, FAIL when all five are over 5 ms by more than the margin (the larger of 5% and the five runs' spread), else INCONCLUSIVE |
| Resolution a PASS needs | at most 5/3 ms (one standard deviation of a figure), read from the run itself |
| On this side, every pair | A's claim runs C01 and PASSes; B's claim runs nothing of its own, PASSes, and its `verdict.made` names A's run |

## The measurement

**The world, per side.** A git repository with `src/cart.ts` and twenty drafted checks (`.deepbuild/checks/c01.sh` to
`c20.sh`, each `sh` running a node:test suite of one test that reads `src/cart.ts`), worktrees for every session, and a
hub from that side's own build (`deep hub run`, the #29 suite's test settings: `DEEP_HUB_TEST_DRAFTS`,
`DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_WORK`, a closed forge port). Sessions are Claude Code sessions played through
that side's own deep-hook, as children of the #29 suite's stand-in Claude Code process. Two asks are handed
definitions: the measuring ask has one requirement checked by C01; the seeding ask has twenty, C01 to C20.

**10,000 keys kept.** On each side, two seeding sessions in worktrees of their own type the seeding ask and claim 500 new
trees between them; each claim runs all twenty checks, so each leaves twenty results on keys no claim had: 10,000. Each
seeding claim must PASS with its twenty runs, and the test counts the distinct passed (check, snapshot) results in the
record before measuring. The merge base's record is seeded the same way, so the two sides differ in the change alone.

**Pairs.** Session A in worktree `wa` and session B in worktree `wb`, both from main's one commit, type the measuring ask.
Each pair writes one new `src/cart.ts` (a tag and random bytes): A claims it and its verdict lands, then B claims the same
content. On this side A's claim is a miss, so C01 runs, and B's claim has a key equal to A's, so A's result carries to
it; on the merge base both run C01. The sides take turns going first, pair by pair, so drift on the machine falls on
both.

**What is timed.** For each claim, from the hub's own record: its gate time is the time from its stop (`agent.stop` of
its session, the claim's stop) to its verdict (`verdict.made` naming it), less the time its own runs took (the first
`run.started` naming it to the last `run.finished`). Two figures per run, each this side's p95 less the merge base's
over the same 200 claims:

- `carried`: B's claims. On this side the gate time is the whole wait, as B runs nothing; on the merge base it is the
  wait less B's own run. This is the criterion's case: what a claim's verdict takes when its result carries across
  sessions, against what the gate took around the run on the merge base.
- `ran`: A's claims, which run on both sides. On this side the gate looks A's key up among the 10,000 kept first, and
  keeps its result after.

**Resolution, and how it was checked.** Each run also computes a noise floor: the merge base's own p95 over its even
pairs less that over its odd pairs. Two samples of one program differ by that much, and since each half is 100 claims,
its spread is about √2 times that of a figure (200 against 200). The test prints the resolution, the root mean square
of the five floors over √2, for each figure, and counts a PASS only when it is at most 5/3 ms, so 5 ms is three standard
deviations of the figure; otherwise the result is INCONCLUSIVE, naming it.

Expected resolution: the standard error of a 95th percentile of 200 samples is √(0.95 × 0.05 / 200) over the density
there, about 0.15 σ for a gate time with standard deviation σ near its tail, so a figure (two of them) has about 0.21 σ:
1 ms at σ = 5 ms, 2 ms at σ = 10 ms. A PASS therefore needs a gate time that spreads by no more than about 8 ms near its
tail, which is what a claim's snapshot and checkout should cost on an idle reference Mac. It has not been measured on a
reference Mac: this job had none.

How it was checked here: only off a reference Mac. On the Linux box this job ran on (aarch64, 20 cores, at a 1-minute load
of 31 to 78 from other work), a scratch A/A run timed this checkout against itself: two hubs from one build, no seeding,
2 runs of 30 pairs. The figures that should read 0 read -25 and -287 ms (`ran`) and -16 and +101 ms (`carried`), with
resolutions of 49 and 173 ms. So on a loaded machine the guard turns any PASS into INCONCLUSIVE, which is its job, and
says nothing about a reference Mac. The first reference-Mac run prints the real resolution.

## Choices, and why

1. **The run carrying replaces earns no credit.** "Adds ... to a claim's verdict" is read as what the gate spends on the
   claim around its runs. A carried claim skips its run; comparing whole waits would pass any carry that costs less than
   a run (hundreds of ms), which can't tell 5 ms. So each side's run time is taken out, and the carried claim's whole
   wait is compared with the merge base's wait around its run.
2. **Both kinds of claim are judged.** The criterion's case is the claim that carries (`carried`). A claim that can't
   carry pays for carrying too: its key is looked up among 10,000 before its check runs, and kept after. `ran` holds that
   to the same 5 ms. **This is the choice most open to question**: a strict reading would judge `carried` alone. Both
   must PASS; either FAIL fails.
3. **Costs inside a run's span aren't seen.** Anything the hub does for keys between `run.started` and `run.finished`,
   such as hashing what the run read, is taken out with the run. Timing whole waits instead would leave the run's own
   noise in, too much to tell 5 ms. A planted twin that hashes inside the run would pass here.
4. **The record's timestamps, never the test's clock.** Both ends are the hub's own events, on the hub's clock in ms, so
   neither deep-hook's start nor the test's polling is in the figure.
5. **10,000 keys over twenty checks.** 10,000 keys on one check would take 10,000 claims; twenty checks on 500 trees take
   500. The measured check, C01, is one of the twenty, so 500 of the kept keys share its check, and the rest share
   everything but the check. Measured pairs add keys as they go, so later runs have more than 10,000 kept.
6. **Gate time per claim, p95 per run, five runs.** The design judges a timing result on five runs after warm-up; each
   run here is a p95 over 200 claims, the issue's statistic. A negative difference counts as 0 ms added, as judgeLimit
   takes no negative reading (as #761's budget does).
7. **The resolution guard is stricter than the design's rule.** judgeLimit passes five readings within the limit however
   noisy they are. A PASS here also needs the run's own noise to resolve 5 ms; FAIL needs no such guard, as five readings
   all over the margin already say so.
8. **The carry is checked on every pair.** A measurement of B's claims times carrying only if B carried. On this side,
   every pair needs A's run of C01, B with no run of its own, both PASS, and B's `verdict.made` naming A's run; otherwise
   the test fails at once, naming the pair. On the merge base this is what fails: B runs C01 of its own.
9. **Warm caches.** Nothing timed here can be flushed between claims; the hubs serve warm, as an agent's hub does, after
   a warm-up of 20 pairs. The design's flushed-cache rule is for timing checks a claim states; this budget's readings say
   warm.
10. **The merge base is built apart.** `git archive` of `git merge-base HEAD origin/main` into `target/`, built with its
    own `npm ci`, workspaces and deep-hook, as `scripts/perf.mjs` and #185 copy it. A build that fails is BLOCKED.
11. **Fit gate:** `scripts/benchmark.mjs`'s `fingerprint` and `judgeLimit` (a reference Mac by model, chip and memory, on
    mains, Low Power Mode off, thermal nominal, macOS build recorded), and a 1-minute load no higher than the core count,
    before and after. Off it the test skips as INCONCLUSIVE before building or measuring anything.

## The surface it assumes

Only what the base already has and the issue and design keep, so any implementation that follows them meets it:

- `deep hub run`, `deep-hook claude-code <event>`, the test settings `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_CONFIRM`,
  `DEEP_HUB_TEST_WORK`, `DEEP_HUB_TEST_FORGE`, and `events.read` on the hub's socket with the control token.
- A stop whose turn did work is a claim (the stop rule), recorded as `claim.made` in the session; its stop as
  `agent.stop`; its verdict as `verdict.made` with `data.claim`; each run as `run.started` (`data.run`, `claim`, `check`,
  `commit`) and `run.finished` (`data.run`, `outcome`).
- A carried result is a run the claim reads, not a run it starts: a carried claim has no `run.started` naming it, and its
  verdict names the run it counted (design: each requirement lists the runs it counted by handle; issue: carried, naming
  the run). The test looks for A's run handle anywhere in B's `verdict.made` data, never in a named field.
- Sessions in worktrees of one repository are in one repo; equal trees, one check definition, one host and one toolchain
  give equal keys (issue, Scope).

## Requirement → test

| Requirement | Where |
|---|---|
| Carrying across sessions adds under 5 ms at p95 to a claim's verdict | `carried`, judged by judgeLimit |
| ... and to a claim that runs, while keys are kept | `ran` (choice 2) |
| With 10,000 keys kept | `seed`, and the count of kept results before measuring |
| Compared with the merge base, both sides in one run | `mergeBaseSide`, `pairs` alternating sides |
| A result really carries | `carriedOrFail` on every pair |
| On the reference Mac | `machineProblem` before, `loadProblem` after |

## Proof of the test, and what wasn't run

Run at base `69803b94` on Linux (`BASE-FAILURE.txt`). The test skipped as INCONCLUSIVE at the fit gate in 54 ms
(`model is null ... the macOS build is missing`), before it built or measured anything, so it never passes off a reference
Mac.

The carry check, run through scratch code that wasn't kept, on two hubs of this base (no #1018): on the first pair,
`carriedOrFail` failed with "this side's B claim ... must read A's result (run:...) as carried and run nothing of its
own; it ran run:... (.deepbuild/checks/c01.sh)". That is the failure a reference Mac shows at the base: an assertion,
before any timing. The seeding claim (twenty checks, all fast lane, PASS) and the measured pair drive also ran there.

**Never run:** the merge base export and build, 10,000 seeded keys (the largest seed run here was 2 claims; a
200-key seed on the loaded box timed out waiting for a verdict, at load 55), five runs of 200 pairs, and any reference
Mac. No implementation of #1018 existed, so neither the `carried` figure on a real carry nor a planted slow carry was
timed.

## Files

- `budgets.test.ts`: the test. `helpers.ts`: the two sides, the world, the hub, the session player, the record reader and
  the figures. `tsconfig.json`: the root options with `noEmit`. `BASE-FAILURE.txt`: the run at the base.

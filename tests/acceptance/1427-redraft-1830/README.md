# Blind redraft of #1427's criterion 8 budget for #1830: judgeLimit is given the loads

`ac8-budget.live.test.ts` here replaces `../1427/ac8-budget.live.test.ts`. Criterion 8 (`#1427.dd0b4e03`): "Budgets, on
the reference Mac in the local preflight: the check adds under 2 s to a 30-second journey."

Why: since #1555, `judgeLimit` reads INCONCLUSIVE when a call gives no `loads`, and the first draft called it with `limit`,
`runs` and `fingerprint` only, so criterion 8 read INCONCLUSIVE on every machine, the reference Macs included (#1830). Here
each of the five pairs reads the one-minute load average (`os.loadavg()[0]`) at its start and at its end, and the
`judgeLimit` call passes the five `{ start, end }` in the pairs' order. The describe and test names, the journey, the pairs
and the 2,000 ms limit are unchanged.

## What was read

AGENTS.md; issues #1830 and #1427 (bodies only); `../1427/ac8-budget.live.test.ts` (the first draft), `../1427/helpers.ts`
(imported, frozen: `Drive`, `motionCheck`, `launchLab`, `press`, `waitUntil`, which reuse `../124/helpers.ts`),
`../1427/README.md` (Run them; The criteria; What the implementer adds); `scripts/benchmark.mjs` (`judgeLimit`,
`fingerprint`); `docs/technical-design.md`: How we know version 0 works (the timing rule; Load), The reference Macs,
Dogfooding.

## How to run

By hand only, never in CI, on a reference Mac on mains power with Low Power Mode off, the thermal state nominal and nothing
else running:

```sh
npm ci                                                       # once
node node_modules/typescript/bin/tsc -p tests/acceptance/1427-redraft-1830/tsconfig.json
DEEP_MOTION_BUDGETS=1 npx vitest run --root tests/acceptance/1427-redraft-1830 ac8-budget.live.test.ts --no-file-parallelism
```

It builds `deep-drive` with cargo and starts twelve replicas, each running a 30-second journey on the virtual clock;
without `DEEP_MOTION_BUDGETS=1` it skips. macOS only: off macOS it fails `INCONCLUSIVE:` and never passes.

## The test

`#1427 AC8 the check adds under 2 s to a 30-second journey, on the reference Mac` › `five pairs after a warm-up pair: the
checked run less the plain run, each under 2,000 ms` (names unchanged).

| | Value |
|---|---|
| Journey | the lab panel: launch, press Drift long, wait to 1 s, press Flicker 3, Overshoot and Jump, wait to 30 s, expect Jump visible |
| A pair | a plain run (calls driven one by one in a fresh `deep-drive`, nothing recorded), then a checked run (`motion_check` on the same journey in a fresh `deep-drive`, at least 3,598 frames recorded); each timed from spawning `deep-drive` to the last answer |
| A reading | the checked run less the plain run, floored at 0 ms |
| A pair's load | `os.loadavg()[0]` before the plain run and after the checked run |
| Judge | `judgeLimit({ limit: 2000, runs, fingerprint: fingerprint(), loads })` on five pairs after one warm-up pair |

Outcomes, as the first draft has them: only PASS passes. FAIL fails with a message starting `FAIL`. INCONCLUSIVE or BLOCKED
also fails, with a message starting `INCONCLUSIVE` and `judgeLimit`'s whole result, its reason included (off the reference
Macs, off their conditions, or a pair's load above the core count).

## Wrong program it fails on

A recorder that adds 2 s or more to the journey in all five pairs by more than the margin reads FAIL on a fit reference
Mac. A pair under load can't pass: it fails as INCONCLUSIVE, naming the load.

## Not run

Typecheck only, at base `3557b348` on 2026-11-15: `tsc` exits 0. The test itself was not run: it starts real replicas and
was kept to a by-hand run on a reference Mac. This Mac (a Mac17,10) runs at a one-minute load in the hundreds on 18 cores,
so a run here would read INCONCLUSIVE, naming the load.

## Readings

- **What a run is** for the load: one pair, since one reading comes from a pair. Its start is read before the plain run and
  its end after the checked run, so the two readings bracket both halves.

# Blind redraft of #124's criterion 5 timings for #1830: judgeLimit is given the loads

`ac5-budgets.live.test.ts` here replaces `../124/ac5-budgets.live.test.ts`. Criterion `#124.b8efd107`: "Budgets, on the
reference Mac in the local preflight, compared with the merge base: a replica launches in under 2 s, an action's round trip
takes under 50 ms plus its wait, a 2,000-node snapshot under 20 ms, and a replica stays under 500 MB, with at most two per
machine under a lease." This file holds the four numbers; the merge-base comparison and the two-per-machine lease stay with
`../124/ac5-lease.test.ts`.

Why: since #1555, `judgeLimit` reads INCONCLUSIVE when a call gives no `loads`, and the first draft called it with `limit`,
`runs` and `fingerprint` only, so each of the four read INCONCLUSIVE on every machine, the reference Macs included (#1830).
Each run here reads the one-minute load average (`os.loadavg()[0]`) at its start and at its end, and each `judgeLimit` call
passes the five `{ start, end }` in the runs' order. The four tests' names, what they measure and their limits are unchanged.

## What was read

AGENTS.md; issues #1830 and #124 (bodies only); `../124/ac5-budgets.live.test.ts` (the first draft), `../124/helpers.ts`
(imported, frozen: `Drive`, `launch`, `replay`, the issue's numbers), `../124/README.md` (The hub, the lease and the perf
lane; Criteria; Live only, and why); `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`); `docs/technical-design.md`: How
we know version 0 works (the timing rule; Load), The reference Macs, Dogfooding.

## How to run

By hand only, never in CI, on a reference Mac on mains power with Low Power Mode off, the thermal state nominal and nothing
else running:

```sh
npm ci                                                       # once
node node_modules/typescript/bin/tsc -p tests/acceptance/124-redraft-1830/tsconfig.json
DEEP_DRIVE_BUDGETS=1 npx vitest run --root tests/acceptance/124-redraft-1830 ac5-budgets.live.test.ts --no-file-parallelism
```

It builds `deep-drive` with cargo (`../124/helpers.ts`, `buildDrive`) and starts real replicas; without
`DEEP_DRIVE_BUDGETS=1` all four tests skip. macOS only: off macOS each fails `INCONCLUSIVE:` and never passes.

## Tests

| Test (name unchanged) | Five readings | A run's load is read |
|---|---|---|
| `#124.b8efd107 a replica launches in under 2 s: from spawning deep-drive to launch's answer, five times after a warm-up` | ms from spawning `deep-drive` to `launch`'s answer, against 2,000 | before the spawn, and when the answer is in (before the stop) |
| `#124.b8efd107 an action's round trip takes under 50 ms plus its wait: five clicks on a field already visible, enabled and still` | each click's round trip less its `waited_ms`, against 50 | before the call and after its answer |
| `#124.b8efd107 a 2,000-node snapshot takes under 20 ms` | each `see` of the 2,000-node panel, against 20 | before the call and after its answer |
| `#124.b8efd107 a replica stays under 500 MB: its peak resident memory over a recorded run's replay, five replays` | peak RSS over each replay, against 500,000,000 bytes | before the replay starts, and after its sampler stops (before the stop) |

Outcomes, as the first draft has them: only PASS passes. FAIL fails with a message starting `FAIL`. INCONCLUSIVE or BLOCKED
also fails, with a message starting `INCONCLUSIVE` and `judgeLimit`'s whole result, its reason included (off the reference
Macs, off their conditions, or a run's load above the core count). Nothing here passes without a PASS.

## Wrong programs it fails on

A replica that launches in 2 s or more, a click whose round trip less its wait is 50 ms or more, a snapshot of 20 ms or
more, or a replica of 500 MB or more, in all five runs by more than the margin, reads FAIL on a fit reference Mac. A run under
load can't pass: it fails as INCONCLUSIVE, naming the load.

## Not run

Typecheck only, at base `3557b348` on 2026-11-15: `tsc` exits 0. The test itself was not run: it starts real replicas and
was kept to a by-hand run on a reference Mac. This Mac (a Mac17,10) runs at a one-minute load in the hundreds on 18 cores,
so a run here would read INCONCLUSIVE, naming the load, for all four.

## Readings

- **What a run is** for the load: the timed span of each reading (a launch, one call, one replay), not the warm-up.
- **The memory limit** is judged with the loads too: `judgeLimit` takes them for any limit, and the design's rule names
  timing and memory budgets alike for where a result counts.
- **The fingerprint** is read once, when the five are judged, as in the first draft.

# Acceptance tests for #3137: the preflight's unit lane in shards, and the preflight budget's approved move

I drafted these tests blind from these sources only:

- issue #3137 (`gh issue view 3137`), its three acceptance criteria
- the owner's decision on it (2026-11-22): the preflight's unit lane runs its alone block in shards as
  `scripts/affected.mjs` does, through that script's own entry, on the run's jobserver, then the exclusive folders one
  at a time, with the slow and timed files still run in full; and the `preflight` budget gets an approved-proposal path
  like the task budgets got in #2665, which records a measured full run, and a move with no approval still fails
- the design text the change adds: a new bullet in `docs/parallel-proof.md` section 7a ("The preflight's alone block"),
  one in section 12a ("The preflight's budget"), and a new subsection at the end of `docs/technical-design.md`'s How we
  know version 0 works ("The preflight's unit lane and its budget")
- AGENTS.md, and the base commit `c52dc3e73`, which has no implementation

At the base I read `scripts/benchmark.mjs`, `lanes.mjs`, `affected.mjs`, `preflight.mjs`, `proof-approvals.mjs`,
`proof-binaries.mjs`, `shards.mjs`, `throttle.mjs`, the callers of `validateBudgets` in `perf.mjs` and
`budget-window.mjs`, `tests/fixtures/approver.mjs`, `tests/shards.test.mjs` and `tests/acceptance/2665/` for their shape.
The only module imported from outside this folder is `tests/fixtures/approver.mjs`, the repo's stand-in for a person's
security key. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft.

## Criteria and tests

| Criterion | ID | Test |
|---|---|---|
| AC1: the design states how the release preflight runs the unit lane and what the `preflight` budget covers, as the owner decided | `#3137.b240111e` | The statement itself is the design text under review. `unit-lane.test.mjs` proves the decision's unit-lane behavior (one test, below) |
| AC2: `scripts/benchmark.mjs` accepts a move of the budget only with an approval that records the measured run, and still refuses one without it | `#3137.3f5777c3` | `budget.test.mjs`, seven tests |
| AC3: a measured full preflight on a reference Mac, with its date, machine, load and elapsed time, within the budget or saying how far over | `#3137.692b5e16` | None: out of the suite's reach (below) |

### `budget.test.mjs` (AC2)

Each scene is the next change that moves the budget: the merge base is this checkout's own `benchmarks/budgets.json`, and
the change moves `preflight.limits.elapsedMs` up by 600,000 ms, recording `measured: {date, machine, load, elapsedMs}`
(a day, the model of the reference Mac in `references` with the fewest cores, load 3.4, 1,320,017 ms) and a
`changeReason` of its own that names that run. The move's item is `benchmarks/budgets.json › preflight › elapsedMs
<before> → <after>`, as the design gives it. Each calls `validateBudgets(current, base, approved)`, the surface perf and
the budget window call with `approvedItems`.

1. A commit that moves the budget, approved by the maintainer's signed tag naming that move, passes `validateBudgets`
   with the items `approvedItems` reads from a fixture repository's tags.
2. The same move with no approval is refused, and the refusal names the item that would approve it; so is the same
   move tagged only by a key the merge base's `.deepbuild/approvers` doesn't list.
3. Items for other moves (another number, a longer number starting with this one's, another limit, the reverse move, a
   task's budget) don't approve it: refused, naming its own item.
4. An approved move that records no measured run, or one missing its day, machine, load or elapsed time, is refused,
   where the same move recording its run is accepted.
5. An approved move measured on a Mac that is none of the reference Macs is refused, where the same run on the reference
   Mac is accepted.
6. An approved move measured at a one-minute load equal to, or above, that reference Mac's cores (but below another
   reference Mac's) is refused.
7. Once a move recorded its run, an approved further move recording the same run again, or keeping the earlier move's
   `changeReason`, is refused, where one recording a new run is accepted ("a run no earlier move recorded, with a
   `changeReason` of its own").

Tests 4 to 7 each hold their accepted case first, so each fails on a program that refuses every move as well as on one
that takes a move it should refuse.

### `unit-lane.test.mjs` (AC1, the owner's decision)

One test. A scratch repository holds this checkout's `scripts/`, `package.json`, `vitest.config.ts` and
`tests/vitest-setup.ts`, a link to its `node_modules`, a cargo stub first on `PATH`, lint scripts replaced by stand-ins
that note they ran, an empty `known-failures.json`, and vitest probe files at paths lanes.mjs's own lists give: in one
alone folder a probe `a`, the slow list's file there and a planted failing test; in a second alone folder a probe `b`;
in the first exclusive folder a probe `x`; the timed list's file in a third alone folder; and a parallel-block file
outside every alone folder. Its `origin/main` is its HEAD, so the change is empty. With HOME a sandbox (its own throttle
table under `node --test`, its own shards and lane records), `DEEP_SHARDS=2` and `DEEP_TEST_SHARD_FLOOR=0`, a child
imports the scratch repository's `lanes.mjs` and calls `runLanes` over the unit lane of `checks` with only its alone
command (`aloneCommand` where lanes.mjs exports it, else the unit lane's `--no-file-parallelism` command), as
`scripts/preflight.mjs` reaches it through `checks.mjs`. `a` and `b` each wait up to 90 s for the other to start, so two
folders that run at once always overlap however their starts fall. The test asserts:

- the unit lane in `checks` holds that alone command;
- every probe of the block ran;
- `a` and `b` ran at the same time, each in its own shard under `<HOME>/deepbuild-shards/`, with the same
  `CARGO_MAKEFLAGS` jobserver;
- `x` ran in the worktree after every alone-folder file ended;
- the timed file ran last, in the worktree, under a `timed:` grant;
- neither the parallel-block file nor any lint script ran;
- the lane's evidence record, `<HOME>/.deepbuild/lanes/<tree>-unit.json`, reads `FAIL` and holds each probe's test,
  the planted one as `FAIL` and the others as `PASS`, and `runLanes` exits non-zero.

### Not tested

- **AC3** needs a full timed `scripts/preflight` on a quiet reference Mac: a timed grant of the machine's own throttle
  table, which drains every other session's builds and tests, and a one-minute load below the Mac's cores. A test can't
  make one: under `node --test` with a sandboxed HOME the throttle table and load readings are a stand-in, and a stand-in
  machine's elapsed time is no measurement. The machine this suite was drafted on, a Mac17,10 shared by many sessions
  at loads of 160 to 280, must not start one at all. Its proof is the run itself: the date, machine, load and elapsed
  time in the preflight's record or the budget's `measured` entry, read by a person or the release.
- **AC1's statement** is the design text under review; no test reads doc wording.
- The decision's "the main watch runs the same unit lane" follows from the lane, and isn't tested apart.

## Running them

```sh
npm ci --ignore-scripts --no-audit --no-fund    # once; affected.mjs and proof-change.mjs import typescript
npm run build --workspaces                      # once
node --test tests/acceptance/3137/budget.test.mjs
node --test --test-timeout=3000000 tests/acceptance/3137/unit-lane.test.mjs
```

On a shared machine, through its throttle: `node scripts/throttle.mjs test --wait 30 -- scripts/lease node --test <file>`.
`budget.test.mjs` takes seconds. `unit-lane.test.mjs` runs several vitest processes in a fixture and takes minutes under
load; give it a long timeout. Neither reads this machine's load or the reference Mac, so neither is on the timed list.

## On the base

`BASE-FAILURE.txt` holds each file's run on the base `c52dc3e73`, one run each. Every test fails at its own assertion:

- `budget.test.mjs`: 7 of 7 fail, on the base's refusal of any second preflight move, "Budget preflight changed or
  disappeared; restore its frozen definition". Tests 1 and 4 to 7 fail at their accepted case; tests 2 and 3 at their
  refusal not naming `benchmarks/budgets.json › preflight › elapsedMs 900000 → 1500000`.
- `unit-lane.test.mjs`: fails at "the two alone folders ran one after the other, not side by side". The base's unit lane
  ran all six probes in one vitest run in the worktree, one at a time, under the lane's build grant, with no shard, no
  jobserver and no timed grant (b waited its full 90 s for a). The lane's record did hold the planted test as FAIL.

## Checked against a throwaway implementation

To check the suite can pass, I wrote a minimal implementation in a scratch copy of the base's `scripts/` (not
committed): `validateBudgets` takes a second preflight move only with each moved limit's item among the approved ones,
then refuses one with no `measured` run, a day not `YYYY-MM-DD`, a machine none of `references`' models, a load not below
that Mac's cores, no elapsed time, the run the merge base's entry records, or the merge base's `changeReason`;
`lanes.mjs` exports `aloneCommand`, the unit lane holds it, and `runLanes` runs it as `node scripts/affected.mjs --alone
--slow --timed --results=<file>` and reads each test's state from that file; `affected.mjs --alone` takes the files
`commandFiles` lists for `aloneCommand`, whatever the change, skips the lints and the settled list, and writes each test's
state into `--results`. Both files passed on it, 7 of 7 and 1 of 1 (the unit-lane test in 12 s).

Three faults planted in it, one run each, each failed only the test aimed at it:

| Fault | Fails |
|---|---|
| any item starting `benchmarks/budgets.json › preflight › ` approves the move | test 3 (another move's items) |
| no check of the measured run at all | tests 4, 5, 6 and 7 |
| the load judged against the largest reference Mac's cores | test 6 |

They aren't kept as twins: every test here already fails on the base, and each twin would be a full copy of
`benchmark.mjs`.

My worktree started at `28bfe9a9b`, two merges past the base; I reset my own branch to `c52dc3e73` before reading any
code, so the suite saw only the base.

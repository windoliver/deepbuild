# Acceptance tests for #3265: `grid.reach` counts the distinct floors at each depth and fails a generator that repeats them

Written first, blind, from issue #3265 ("Floors a game says it generates must differ from run to run": its Scope, 4
acceptance criteria and Proof line; no comments), the design sections it links and the base commit 7cb1e5c4a ("Merge
pull request #3330 …"), by a job that never saw an implementation; none existed, and no other worktree, branch, pull
request, plan or session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding). Lean: one test file per criterion, with the twins each criterion names.

## What was read

- The issue, live (`gh issue view 3265 --repo windoliver/deepbuild`). Its 4 criteria are tagged by
  `scripts/proof-change.mjs`'s rule (`#3265.` and the first 8 hex of SHA-256 of the text, white space collapsed).
- `node scripts/design-section.mjs --issue 3265`: `docs/canvas-primitives.md`, Check input: `grid.reach` and Check input:
  playtest. `docs/technical-design.md`, the sentence of Checks for work beyond code on `grid.reach`. AGENTS.md.
  `docs/parallel-proof.md`, section 7 (a suite's own lane file).
- At the base, read only for the surfaces these tests use: `tests/acceptance/556` (README, `helpers.ts`, `programs.ts`,
  `ac01`, `ac03`, `ac04`, `ac06`, `ac07`), `tests/acceptance/184/helpers.ts`, parts of `533/helpers.ts`,
  `555/helpers.ts` and `555/programs.ts`; `packages/checks/playtest` (`reach.ts`, `types.ts`, `kit.ts`, `codes.ts`,
  `deepbuild.json`, `index.ts`, `run.ts`, part of `iface.ts`) and `packages/checks/test/playtest.test.ts`;
  `packages/conformance` (`slot-types.ts`, `slot-runner.ts`); `packages/extension-host/src/host.ts` (`runCheck`,
  `judgeCheck`); `packages/verdicts/src/engine.ts` (how a run's outcome is read); `packages/checks/catalog/dominance.ts`
  (how a check kind reports INCONCLUSIVE, #832); `crates/deep-logic` (`play.rs`'s `seeded`, `piece.rs`'s `step_seed`).

What the base does, which these tests don't credit: `grid.reach` reads no `differ`, so a generator that gives every run
one floor passes, `differ` with `piece_seed: own` is played and passes, a depth one run
reached passes, and the plug-in's manifest lists no `grid.same`. The base's manifest also holds an older digest than its
files' (`run.ts` changed in a4eb329a5 and the digest wasn't refilled), so the host refuses to install the shipped folder
("envelope digest … isn't its files' digest") and every hub of #556's suite fails there. So that a test fails for what it
asserts, this suite's hub (`helpers.ts`, `openHub`, otherwise #556's) installs a copy of the folder whose manifest holds
its files' digest, every other byte the folder's, and AC1 ends by holding the shipped manifest to its files' digest. What
it already does, which they rely on: #184's replica
and #556's grid.reach, whose result holds `floors` (with each floor's `hash`), `coverage` and `distinct`.

## Run them

```sh
npm ci                          # once, in a fresh worktree
npm run build --workspaces      # once, as #556's suite has it
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 60 -- npx vitest run --root tests/acceptance/3265 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/3265/tsconfig.json
```

The builds, each once a file and honoring `CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` (#184's helper),
`deep-logic` (#533's: the layout probe) and #533's assembler from a copy (#555's). A clean target takes minutes for the
first; with the binaries built a file takes about 5 s. The folder runs alone by its own `lane.json`, reason `binary`, as
#556's does: its files build binaries into this checkout's `target/` and start replicas and hubs. Nothing depends on time
or load.

Gates. Off macOS every test that plays fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any other OS),
never a pass; criterion 4's design test runs anywhere. Cargo that can't run is `BLOCKED:`. Folders are temporary and
deleted; processes are #184's helpers' children, stopped by PID.

## The surface

The issue and the design name `differ: ratio` in `grid.reach`'s input, with no default; the code `grid.same {depth, runs,
distinct}`; that `differ` with `piece_seed: own` is refused, naming both; that a depth only one run generated reads
INCONCLUSIVE; and `distinct: {depth → floors}` in the result. #556's surface (its README: The surface) stays as it is.
Where they leave a choice this suite reads it as follows, and asserts no more:

- **`reach.differ`** beside `grid.reach`'s other fields in the spec's `reach`; the playtest it names, with its
  `piece_seed`, in the spec's `play`, as #556 spells both.
- **Every depth a run generated is judged**, listed in `depths` or not ("of the runs that generated a depth"), by its
  `distinct` over its `coverage`: at least `differ` passes, so 2 of 20 passes `differ: 0.1`. With no `differ` no depth is.
- **`grid.same`**: the outcome is `failed`, with one failure per depth under the share, its message starting `grid.same`
  and naming **`depth <d>`**, the runs as **`<n> runs`** and the distinct floors as **`<n> floor(s)`** (a word may stand
  between, as in `1 distinct floor`; `runs <n>` and `distinct <n>`, with or without a colon, are read too). The rest of
  the wording is free, and so is the failure's `test` (`depth <d>`, as the BLOCKED failure's, would follow the base). The
  manifest's `codes` list `grid.same`.
- **The refusal**: by the plug-in, through `runCheck`, before any run, as the base refuses an input: not `passed`,
  `testsRun` 0, every replica call an error or a play of no step, and one failure whose message holds the word
  `refused` and names `differ` and `piece_seed`. A playtest that leaves `piece_seed` out is `own` (the design's default),
  so it's refused too.
- **INCONCLUSIVE**: the outcome `uncounted`, with a failure whose message starts `INCONCLUSIVE:` and names `depth <d>`:
  what #832's `catalog.dominance` reports on main, which `judgeCheck` reads INCONCLUSIVE and the verdict engine never
  counts. With a depth that fails, the outcome stays `failed`; with an unseen depth of `depths`, `missing` (BLOCKED).
  Neither mix is asserted here.
- **The planted check** of criterion 2 is a planted runner of the plug-in's kit, beside `offset-even` and
  `stacked-layers`: **`reachKit(…).planted` holds a fill named `previous-run`**, which is grid.reach but that its `differ`
  rule compares each run's floor at a depth only with that of the run before it (runs in the check's order), so a floor
  counts as distinct when it differs from that one. The kit's fixed part holds cases whose input sets `differ`, the
  reference fill passing each; on `previous-run` one reads FAIL with code `grid.same`. (The playtest's design: each code
  has a planted twin in its conformance kit.)

## Fixtures (`programs.ts`)

One logic item, `gen`: an 8 × 8 grid and its depth. Row 0 is open from the start (0, 0) to the exit (7, 0), so every
floor's exit is reached and reach alone passes each twin; each other cell is blocked where its bit of the floor's pattern
is 1. The twins differ only in what they read of the seed their `init` gets:

| Twin | Depth 1's pattern | Deeper | This suite's count over 20 runs |
|---|---|---|---|
| `clean` | the whole seed | none | 20 floors |
| `blind` | none of the seed | none | 1 floor |
| `lowbit` | one of two, by its low bit | none | 2 floors |
| `stairs` | the whole seed | at step 1, depth 2 when bits 8 to 11 are 0 | 20 floors; depth 2: 1 run |
| `mixed` | one of two, by its low bit | at step 1, depth 2, one of four by bits 1 and 2; at step 2, depth 3 when bit 4 is 0 | 2; 4; 11 floors of 11 runs |

Each is played by 20 runs of 3 steps of a policy that puts nothing, under an interface with the grid and `floor:
gen.depth`. A run's seed is hash(the check's seed, i), and the seed `init` gets is hash(that seed, the logic ID, 0), so
the order the floors come in is the check seed's: on 3265 the lowbit generator's two come in no order (0010 1110 1010
1100 1001) and one run of the stairs generator goes down; on 348812 the lowbit generator's two alternate. Both seeds were
found by search and are read back in every test: the counts are this suite's own, by its own hash of the grids its own
one-run plays recorded (`helpers.ts`, `counted`), never the check's numbers, and each test holds them before it judges.

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #3265.757907b5 | 20 runs give 20 floors and differ 0.9 passes; the twin that reads no seed gives 1 and fails grid.same; it passes on the base | `ac01-differ.test.ts`: clean passes, 20 runs, distinct {1: 20}; blind passes with no differ; blind fails grid.same alone, naming depth 1, 20 runs, 1 floor, distinct {1: 1}; the manifest lists the code and its files' digest. Fails on the base (blind passes), a check with a default share, one that counts runs |
| AC2 #3265.e9560b44 | two floors by the low bit: 2 of 20, fails at 0.9; the planted previous-run check passes alternating floors and fails this test | `ac02-two-floors.test.ts`: lowbit fails grid.same naming depth 1, 20 runs, 2 floors with `depths` left out, and passes differ 0.1; on the alternating seed `previous-run` passes, this criterion's judge (`sameWrong`) faults it, the kit's reference and the hub's grid.reach fail it, and the kit catches `previous-run` by `grid.same`. Fails on the base, a check that compares neighbouring runs, one that ignores the ratio, one that judges listed depths alone |
| AC3 #3265.5fc6d08d | differ with piece_seed own refused, naming both; a depth one run reached INCONCLUSIVE, naming it | `ac03-own-and-single.test.ts`: own and left out, each refused before any run, naming both; stairs reads `uncounted`, one failure, INCONCLUSIVE naming depth 2, coverage and distinct 1, the verdict never PASS. Fails on the base (all pass), a check that plays the runs and fails grid.same, one that takes a missing piece_seed as run, one that passes or fails 1 of 1 |
| AC4 #3265.db483311 | distinct equals the count of distinct hashes at each depth; the design's Result line lists it | `ac04-distinct.test.ts`: mixed's distinct {1: 2, 2: 4, 3: 11} equals this suite's count and the floors' own hashes, and depths 1 and 2 fail grid.same with those counts, depth 3 not; the Result line of Check input: `grid.reach` lists `distinct: {depth → floors}`. Fails on the base (no failure; no such field in the line), a report that counts runs, floors, or floors across depths |

## Readings where the issue leaves a choice

- **"The twin passes on the merge base, and that run is shown"** is BASE-FAILURE.txt's part: AC1's test fails on the base
  at the assertion that the twin fails, whose message holds the base's result (passed, testsRun 20, distinct 1).
- **"A planted check … fails this test"** is `sameWrong`, the function every grid.same assertion here goes through, given
  the planted check's result: it must find fault.
- **The low bit** is the low bit of the seed the program reads, the one its `init` gets, which isn't the run's seed but a
  hash of it; a generator sees no other.
- **"20 distinct floors"** counts recorded floors, one a run at depth 1 (`floor` changes only when a run goes down).
- **AC4 holds the numbers of `grid.same` too**, since a failure that names counts other than the result's would make
  `distinct` a number the check doesn't use.

## Not covered (scope with no criterion here)

A run that goes back to a depth it generated before; `differ` outside 0 to 1; `differ` with the flow form; several bots;
a depth that fails beside one only one run reached; `ready`; the code's meaning and fix in the check catalog; the
design's other lines (the field, the code) beyond the Result line.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `lane.json`, `helpers.ts` (the hub, this suite's own count and the
message readers), `programs.ts` (the generators, their interface and inputs), and one test file per criterion:
`ac01-differ`, `ac02-two-floors`, `ac03-own-and-single`, `ac04-distinct`.

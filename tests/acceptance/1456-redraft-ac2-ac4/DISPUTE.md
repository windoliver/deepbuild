# Dispute: the first draft's planted programs for AC2 and AC4 never build

This redraft exists because of this dispute. The first drafts are `tests/acceptance/1456/legacy.test.ts` (AC2,
`#1456.f70bc414`, twin `legacy-readings-unread`) and `tests/acceptance/1456/agree.test.ts` (AC4, `#1456.6799dc51`,
twin `waiting-as-working`). This file is the work's, not the blind job's. The job wrote the other files of this folder
and never saw this one.

## What fails

Both criteria hold at the merge base by design, so a twin is their only wrong program. Both first-draft twins replace
`packages/hub/src/plant.ts` with the base's copy, `Plant` widened to `string` (`export type Plant = string`). Laid over
the change, the workspaces' build fails, so the proof lane's `before` step can run neither:

```
BLOCKED before: tests/acceptance/1456/legacy.test.ts › AC2 #1456.f70bc414 › …: cannot run on its planted wrong program
legacy-readings-unread: npm run build --workspaces --if-present failed
BLOCKED before: tests/acceptance/1456/agree.test.ts › AC4 #1456.6799dc51 › …: cannot run on its planted wrong program
waiting-as-working: npm run build --workspaces --if-present failed
FAIL trace: Closes #1456 refused: this change is Part of #1456; open: #1456.f70bc414, #1456.6799dc51
```

The build error, with either twin laid over:

```
packages/hub/src/core.ts(946,66): error TS2379: … Types of property 'plant' are incompatible.
  Type 'string' is not assignable to type 'Plant'.
```

`core.ts` narrows `this.options.plant` to names the extension host's `Plant` takes, and a `string` doesn't narrow. That
code came with d14697c58, which is in the first draft's base 118ec119f. So the twins don't build at that base either.
The work can't change them (AGENTS.md: agents can't change checks).

## How the redraft was made

The two criteria went to a fresh run of the suite's blind job with the same inputs: issue #1456, the design, and base
`118ec119f`. That base was a clone of main alone, holding no other branch. The job never saw the work, the first
draft or this dispute. It was told to write the tests of criteria 2 and 4, and given the proof lane's general rules: a
regression guard needs a planted wrong program, every planted program must build when laid over its checkout, and
each test must fail at its assertion on it. It was not told why a redraft was asked for.

It found the same thing by itself. Its first build of a plant twin with `Plant` widened to `string` failed with TS2379
at `core.ts`, as its report and README say. Its twins therefore keep the base's union. It wrote:

- AC2 (`replay.test.ts`): a record the base wrote, `fixtures/ledger.db`, replayed through `openRecord().rebuild()`. The
  test asserts that each of its eight sessions reads the base's row and rule (`fixtures/base-states.json`). It has two
  twins: `legacy-readings-unread`, the base's `status.ts` taking only readings with a code, and
  `legacy-table-skipped`, a plant the change's one legacy table must honour.
- AC4 (`agree.test.ts`): #992's `agree.test.ts`, run as it is. Its twin, `app-maps-waiting-to-working`, is the base's
  `plant.ts` giving the base's own plant `waiting-as-working`.

At the base, both tests pass. With `legacy-readings-unread` and `app-maps-waiting-to-working` laid over the base,
each fails at its own assertion (`BASE-FAILURE.txt`). `legacy-table-skipped` passes at the base, since nothing there
reads its name. The work gives the plant `legacy-table-skipped` the meaning the redraft's README asks for, in
`packages/hub/src/reading-codes.ts` (commit 05c1232c0).

On the work (05c1232c0), run once each, with each twin laid over and the workspaces built (`npm run build
--workspaces --if-present`, exit 0 for all three):

| Test | On the work | `legacy-readings-unread` | `legacy-table-skipped` | `app-maps-waiting-to-working` |
|---|---|---|---|---|
| `replay.test.ts` (AC2) | pass, exit 0 | fails at its assertion, naming `hooks-cant-run`, `monitor`, `interrupted` | the same | — |
| `agree.test.ts` (AC4) | pass, exit 0, 13.5 min | — | — | fails at its assertion: `permission-terminal-closed` reads "needs you" in deep status, "working" in the app |

## What is decided, and what is yours

Nothing is decided. The first drafts stay where they are, and the proof lane still finds their twins unbuildable.
No lane skips them yet.

One file of the job's is left out: its `lane.json` (README, "How to run"). The lanes read a lane file only at
`tests/acceptance/<issue>/lane.json`, so the guard refuses one in a redraft folder. The folder runs alone by an entry
in `scripts/lanes-lists.mjs` instead, as #2386's redraft does, for the reason the job gave: `binary`. Its hubs run
`deep-hook` from `target/`, and #992's suite builds `deep-drive` with cargo.

This is the one dispute that comes to you (design: Dogfooding):
- take the redraft's twins, which build and fail at their assertions on the work; or
- hold the first drafts, whose twins can't be built at the base or on the work.

If you take the redraft, `tests/acceptance/1456/legacy.test.ts` and `tests/acceptance/1456/agree.test.ts` go by hand in
`scripts/lanes.mjs`, by your signed tag. The commit for that is prepared on this branch.

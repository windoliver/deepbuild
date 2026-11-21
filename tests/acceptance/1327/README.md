# Acceptance tests for #1327: a new suite says how it runs from its own folder, in `lane.json`

Drafted blind from issue #1327, AGENTS.md, `docs/technical-design.md`, `docs/parallel-proof.md` (section 7) and the
base commit `58d3e19ee` (origin/main). At the base I also read `scripts/lanes.mjs`, `scripts/affected.mjs`,
`scripts/proof.mjs`, `scripts/proof-guard.mjs`, `scripts/proof-change.mjs`, and `tests/acceptance/2813/` and
`tests/acceptance/1114/` for the conventions. The helpers are written here, never imported from another suite. Per
AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

```sh
npm ci                                       # once, if node_modules is missing (proof-change.mjs imports typescript)
node --test 'tests/acceptance/1327/*.test.mjs'
```

Offline. 55–90 s in all on the Mac, most of it `same-blocks.test.mjs` (it reads every test file of the merge base
twice); the other files take a few seconds a test.
`*.test.mjs` files under `tests/acceptance/` aren't in the unit lane; `affected.mjs` and the proof lanes run them.

## The `lane.json` shape these tests expect

The issue leaves the shape open beyond "alone, and why, and nothing else". These tests write the shape those words
most directly imply, at `tests/acceptance/<issue>/lane.json`:

```json
{ "alone": true, "why": "Its tests start a process that holds the machine one port." }
```

A plant is that file with one more key: `"skip": true`, `"byHand": true` or `"timed": true`.

## How the tests reach the code

- **Scenes.** A scene is a scratch git repository in a temp folder: `origin/main` holds a copy of this checkout's
  `scripts/` (and `node_modules` linked to this checkout's, ignored by git) plus the scene's base files; branch
  `change` holds one commit on top saying `Part of #<n>`. Planted issues #9327 (the change's own), #9328 (another
  issue whose suite already landed) and #9330 (a suite whose `lane.json` already landed) are given through
  `DEEP_PROOF_ISSUES`, each with one criterion; there are no approval tags and `DEEP_APPROVERS` names no list.
- **The guard** is the scene's own `node scripts/proof.mjs guard`.
- **The lanes** are read by `lanes-view.mjs`, which imports a `scripts/` folder's own `lanes.mjs`, `affected.mjs` and
  `proof-change.mjs` and prints, per test file: the block `affected.mjs`'s `plan()` puts it in (with its runner), its
  shard group from `shardGroups()`, whether each of `lanes.mjs`'s lists (`alone`, `exclusive`, `byHand`, `timed`,
  `slow`, `ownLane`) names it (by `listed()`), and which of the unit lane's vitest commands (from `checks`) run it:
  the parallel one or the `--no-file-parallelism` one, taking vitest's positional arguments as path filters and its
  `--exclude` values as globs. It decides nothing itself.

Nothing under test is mocked.

## Criteria and tests

| Criterion | Tag | Test |
|---|---|---|
| 1. A new suite with a `lane.json` runs alone, and the guard passes with no tag on its commit | `#1327.73a69977` | `alone.test.mjs` |
| 2. Planted `lane.json` files that ask for a skip, for by-hand and for a timed grant are each refused, naming the file. A planted one in another issue's folder is refused the same way | `#1327.57d2718c` | `plants.test.mjs` (4 tests) |
| 3. Removing or changing a landed `lane.json` with no approval fails the guard, naming the file | `#1327.1272c2b3` | `landed.test.mjs` (2 tests) |
| 4. On the merge base's suites, the lanes run the same tests in the same blocks before and after this change | `#1327.f28ef522` | `same-blocks.test.mjs` |

### 1. `alone.test.mjs`

The change adds `tests/acceptance/9327/suite.test.ts` (a vitest file with one tagged test) and its `lane.json`.
Main already holds `tests/acceptance/9331/suite.test.ts` with no `lane.json`. Asserted: the guard prints no FAIL line,
exits 0 and prints `PASS guard:`; the suite with no `lane.json` is in the parallel block (so "alone" comes from the
file); the new suite is in `affected.mjs`'s alone block, and the unit lane runs it in its alone command only.

### 2. `plants.test.mjs`

Three scenes each add the suite with a `lane.json` carrying `skip`, `byHand` or `timed`. A fourth adds #9327's suite
and a well-shaped `lane.json` in `tests/acceptance/9328/`, the folder of another issue whose suite landed on main
(the change says `Part of #9327`). I read "its own issue's folder" as the folder of the issue the change names.

A plant counts as **refused, naming the file** when either the guard or the lanes exit non-zero with output that holds
the `lane.json`'s path. The issue doesn't say which of the two refuses, nor the wording, so either is accepted. For the
three key plants, where the lanes still load, the suite must also not be put in the skipped (by-hand) or timed block.

### 3. `landed.test.mjs`

Main holds `tests/acceptance/9330/` with its suite and `lane.json`. The change, `Part of #9330`, rewords the `why`
in one test and deletes the file in the other. Asserted: the guard exits non-zero and some `FAIL` line names
`tests/acceptance/9330/lane.json`.

### 4. `same-blocks.test.mjs`

The merge base is `git merge-base HEAD origin/main` of this checkout. Before: `git archive` of the merge base's
`scripts/` and its `*.test.{ts,mjs,js}` files into a temp folder, read with that `scripts/`. After: this checkout's
`scripts/`, in this checkout, over the same files. Every file the scripts count as a test file must read the same on
both sides: block, shard group, list memberships and unit-lane command. The test also requires over 1,000 files with
some alone, so an empty comparison can't pass. On the base, before and after are the same scripts, so **this test
passes on the base**; it guards the change against moving the base's suites. I checked that it fails on a wrong
program: with `tests/acceptance/149/` dropped from `alone` in this checkout's `lanes.mjs` (not kept), it failed naming
11 of #149's files.

## On the base

`BASE-FAILURE.txt`: 7 of 8 fail at their assertions, each because the base reads no `lane.json`: the new suite lands
in the parallel block, and the guard passes every plant, change and removal while the lanes ignore them. AC4's test
passes, as explained above. Before saving that, I checked the tests can pass: with a planted fix in this checkout's
`scripts/` (`lanes.mjs` reading `tests/acceptance/*/lane.json` into `alone` and exiting 1 on any key but `alone` and
`why`; the guard failing an edit or removal of a landed `lane.json`, or an added one outside the named issue's
folder), all 8 passed. The planted fix was reverted.

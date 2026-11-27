# Blind redraft of `#3066.4268aebb`'s test file, for #3699

Drafted blind from issues #3699 and #3066, AGENTS.md, GLOSSARY.md, the design sections both issues link, and the base
commit `894a293f2` (origin/main). It runs in the place of `tests/acceptance/3066/same-failures.test.mjs`, which stays
as written and runs by hand: the change maps it here in `redrafted` and pushes it to `byHand` in
`scripts/lanes-lists.mjs`. Why the first draft can't stay in a lane: `DISPUTE.md`.

```sh
node --test tests/acceptance/3066-redraft-3699/same-failures.test.mjs
```

Offline; needs git and this checkout's `node_modules`. About 8 s on the Mac at load 25. Each test's scratch folders
under `$TMPDIR` are removed after it.

## Where it runs

No `lane.json`: the folder runs in the parallel block, as `tests/acceptance/3066/` does today (no entry in
`scripts/lanes-lists.mjs` and no `lane.json` of its own). It builds no binary, times nothing, and shares no resource:
it reads git and spawns `node` on copies of `scripts/` in scratch folders of its own.

## How the tests reach the code

- **`lanes-read.mjs`** imports a `scripts/` folder's own `lanes.mjs`, `affected.mjs` and `proof-change.mjs` in a
  child, with this checkout as its working folder, and prints `redrafted` and the block `affected.mjs`'s `plan()` puts
  each given test file in (`parallel/<runner>`, `alone/<runner>`, `timed/…`, `slow/…`, `skipped/by hand`, …).
- **Before and after.** The merge base is `git merge-base HEAD origin/main`. Before is its `scripts/`, with every
  `tests/acceptance/<folder>/lane.json` and `<folder>/<sub>/lane.json` it tracks, from `git archive`; after is this
  checkout's `scripts/`. The files compared are the merge base's test files this checkout still holds.
- **Plants.** A copy of this checkout's `scripts/` and `lane.json` files in a scratch folder, with statements appended
  to its `scripts/lanes-lists.mjs`, as the change appends its two lines. Before is this checkout's `scripts/`.
- **The check** (`wrongMoves` in `helpers.mjs`) lists each file whose place changed, the `alone` and `parallel` blocks
  counting as one place. A move to `skipped/by hand` is allowed when `redrafted` has an entry for the file, or for a
  folder ending in `/` that holds it, naming a path this checkout holds that is a `*.test.{mjs,js,ts}` file or a folder
  with one under it. Each listed move names its file and why: `no redrafted entry`, `redraft missing`, `redraft holds
  no test file`, or `leaves its place`.

Nothing is mocked: the lane lists, `plan()` and git are the real ones.

## Tests

| Test | IDs | What it checks |
|---|---|---|
| `scripts/known-failures.json names the same failures as on the merge base: …` | `#3066.4268aebb` | The first draft's first test, carried over as it is: the same test IDs, lint findings (with counts), timing IDs and skips as the merge base's. |
| `every test file of the merge base still runs where it ran, moved only between the alone and parallel blocks or to by hand in the place of a blind redraft …` | `#3066.4268aebb` `#3699.c037e2f6` | On this checkout, the check lists no move. Then a plant that keeps one file, moves one from `parallel` to `alone`, one from `alone` to `parallel` (`tests/dither-fill.test.ts`) and sends one to by hand mapped to this folder: the files land where planted, and the check lists none of them. |
| `a test file of the merge base that moves to by hand with no redrafted entry fails the check, naming the file` | `#3066.4268aebb` `#3699.79b40a54` | On this checkout, no file moved to by hand without an entry. Then a plant of `byHand.push('tests/acceptance/3066/lint-plants.test.mjs')` alone: the check lists exactly that file, `no redrafted entry`. |
| `a test file of the merge base that moves to by hand while its redrafted entry names a missing path, or a path holding no test file, fails the check, naming the file` | `#3066.4268aebb` `#3699.f7548a54` | On this checkout, no file moved to by hand in the place of a missing redraft or one holding no test file. Then a plant sending one file to by hand mapped to `tests/acceptance/3066-redraft-3699-missing/` and another mapped to this folder's `README.md`: the check lists exactly those two, `redraft missing` and `redraft holds no test file`. |

The planted files are `tests/acceptance/3066/`'s other test files, which run in the parallel block on the base.

## Twins

Line form only (`twins/<name>/lines.json`), each `find` matching one place in the file as the change holds it:

| Twin | Lays | Fails |
|---|---|---|
| `unmapped` | drops the change's `Object.assign(redrafted, …)` line, keeping its `byHand.push` | `#3699.c037e2f6`, `#3699.79b40a54`, `#3066.4268aebb` |
| `missing-redraft` | maps the first draft to `tests/acceptance/3066-redraft-3699-missing/` | `#3699.c037e2f6`, `#3699.f7548a54`, `#3066.4268aebb` |
| `redraft-holds-no-test` | maps the first draft to this folder's `README.md` | `#3699.c037e2f6`, `#3699.f7548a54`, `#3066.4268aebb` |
| `names-another-failure` | adds one ID under `failures` in `scripts/known-failures.json` | `#3066.4268aebb` (the first test) |

Each of the last three tests fails on its twins at the assertion on this checkout's moves, naming
`tests/acceptance/3066/same-failures.test.mjs`; the first test fails on `names-another-failure` at its `deepEqual`.
On the merge base every test passes (before and after are one tree), so the twins carry the proof.

## Saved output

`BASE-RESULTS.txt`: the file run (1) on the base as is, (2) on a copy of the base with the change's two lines
appended to `scripts/lanes-lists.mjs`, and (3) on that copy with each twin laid over it.

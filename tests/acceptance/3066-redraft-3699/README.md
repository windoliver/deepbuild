# Blind redraft of `#3066.4268aebb`'s test file, for #3699

Drafted blind from issues #3699 and #3066, AGENTS.md, GLOSSARY.md, the design sections both issues link, and the base
commit of its first draft, and revised since on origin/main `673760b70` (branch commits `74beb4623`, this folder,
and `c7ff5314b`, the change's two lines). It runs in the place of `tests/acceptance/3066/same-failures.test.mjs`, which
stays as written and runs by hand: the change maps it here in `redrafted` and pushes it to `byHand` in
`scripts/lanes-lists.mjs`. Why the first draft can't stay in a lane: `DISPUTE.md`.

```sh
node --test tests/acceptance/3066-redraft-3699/same-failures.test.mjs
```

Offline; needs git and this checkout's `node_modules`. About 55 to 75 s on the Mac at load 35 to 75. The folder
imports nothing from `tests/acceptance/3066/`, whose files it replaces; it reaches `scripts/` only through
`lanes.mjs`, `affected.mjs` and `proof-change.mjs`. Each test's scratch folders
under `$TMPDIR` are removed after it.

## Where it runs

No `lane.json`: the folder runs in the parallel block, as `tests/acceptance/3066/` does today (no entry in
`scripts/lanes-lists.mjs` and no `lane.json` of its own). It builds no binary, times nothing, and shares no resource:
it reads git and spawns `node` on copies of `scripts/` and small git repositories in scratch folders of its own.

## How the tests reach the code

- **`lanes-read.mjs`** imports a `scripts/` folder's own `lanes.mjs`, `affected.mjs` and `proof-change.mjs` in a
  child, with the checkout judged as its working folder, and prints `redrafted`, the lane lists (`alone`, `exclusive`,
  `timed`, `slow`, `byHand`, `ownLane`), the given paths that `proof-change.mjs`'s `isTestFile` calls test files, and
  the block `affected.mjs`'s `plan()` puts each of those the checkout holds in (`parallel/<runner>`,
  `alone/<runner>`, `timed/…`, `slow/…`, `skipped/by hand`, …).
- **Before and after.** The merge base is `git merge-base HEAD origin/main`. Before is its `scripts/`, with every
  `tests/acceptance/<folder>/lane.json` and `<folder>/<sub>/lane.json` it tracks and the test files of those lane
  folders, from `git archive`, so a lane file's `timed` and `slow` names find their files as `laneLists` needs; after
  is the checkout's `scripts/`. The merge base's test files are its tracked paths that its own `isTestFile` accepts,
  as the lanes read them, so a `*.test.ts` under `docs/` is none. Those the checkout still holds are placed; those it
  no longer holds are listed as deleted.
- **Plants.** A copy of this checkout's `scripts/`, its `lane.json` files and the test files of their folders in a
  scratch folder, so the copy's lane files keep their `timed` and `slow` names, with statements appended to its
  `scripts/lanes-lists.mjs`, as the change appends its two lines. Before is this checkout's `scripts/`.
- **Scratch checkouts.** For the cases this checkout doesn't hold (a lane file naming timed and slow files, a deleted
  test file), a new git repository in a scratch folder: this checkout's `scripts/`, a link to its `node_modules`, and
  the planted test files, committed, with `refs/remotes/origin/main` set to that commit. The check then runs on it as
  on this checkout.
- **The check** (`wrongMoves` in `helpers.mjs`) lists each test file of the merge base the checkout no longer holds
  (`deleted`), and each whose place changed, the `alone` and `parallel` blocks counting as one place. A move to
  `skipped/by hand` passes only when `redrafted` has an entry for the file, or for a folder ending in `/` that holds
  it, whose target, resolved against the checkout's root (an absolute one as it is), is inside the checkout as written
  and with links resolved on both sides, is neither the original nor a folder holding it (`.` and `tests/` hold it), exists, and holds a
  test file by `isTestFile` (itself, or one under it) that doesn't run by hand: not on the checkout's `byHand` list and
  not a `tests/acceptance/**.live.test.*` file, as `plan()` reads them. Each listed file names why: `deleted`,
  `no redrafted entry`, `redraft outside the checkout`, `redraft is the original or holds it`, `redraft missing`,
  `redraft holds no test file`, `redraft holds only by-hand test files`, or `leaves its place`.

Nothing is mocked: the lane lists, `plan()` and git are the real ones.

## "A criterion-level rule names the deletion"

`#3699.4c1cb484` lets a deleted test file of the merge base pass when a criterion-level rule names the deletion. No
such rule exists today: the issues, the design sections they link and the lane lists name no deleted test file, and
nothing a checkout holds can name one. `redrafted` names a replacement, not a deletion: its original stays, unedited.
The guard's signed approval (`Approves: <path>`) is a person's ruling on one commit, judged by `proof-guard.mjs`, not
a rule of this check. So this redraft reads the exception as empty: every deleted test file of the merge base fails,
naming the file. A deletion an issue's criterion asks for needs its own change to this check, by an approved proposal
or a redraft, which then names the rule.

## Tests

| Test | IDs | What it checks |
|---|---|---|
| `scripts/known-failures.json names the same failures as on the merge base: …` | `#3066.4268aebb` | The first draft's first test, carried over as it is: the same test IDs, lint findings (with counts), timing IDs and skips as the merge base's. |
| `every test file of the merge base still runs where it ran, moved only between the alone and parallel blocks or to by hand in the place of a blind redraft …` | `#3066.4268aebb` `#3699.c037e2f6` | On this checkout, the check lists nothing, deletions included. Then a plant that keeps one file, moves one from `parallel` to `alone`, one from `alone` to `parallel` and sends one to by hand mapped to this folder: the files land where planted, and the check lists none of them. |
| `a test file of the merge base that moves to by hand with no redrafted entry fails the check, naming the file` | `#3066.4268aebb` `#3699.79b40a54` | On this checkout, no file moved to by hand without an entry. Then a plant of `byHand.push(<subject>)` alone: the check lists exactly that file, `no redrafted entry`. |
| `a test file of the merge base that moves to by hand while its redrafted entry names a missing path, or a path holding no test file, fails the check, naming the file` | `#3066.4268aebb` `#3699.f7548a54` | On this checkout, no file moved to by hand in the place of a missing redraft or one holding no test file. Then a plant sending one file to by hand mapped to `tests/acceptance/3066-redraft-3699-missing/` another mapped to this folder's `README.md`, and a third mapped to this folder's `wrong-checks/`, a folder holding files but no test file: the check lists exactly those three, `redraft missing` and `redraft holds no test file` twice. |
| `a checkout equal to its merge base passes the place check when the merge base's lane.json files name timed and slow files` | `#3066.4268aebb` `#3699.2b06b98e` | A scratch checkout equal to its merge base whose `tests/acceptance/<n>/lane.json` names `budgets.test.ts` as timed and `build.test.ts` as slow, beside `plain.test.ts`: the checkout's lanes place them `timed/vitest`, `slow/vitest` and `alone/vitest` (the scene is the criterion's), the check lists nothing, and the merge base's lanes place them the same. |
| `a move to by hand passes only when its redrafted target is inside the checkout, is not the original or a folder holding it, and holds a test file that is not itself by hand; …` | `#3066.4268aebb` `#3699.e1f9065f` | On this checkout, no file moved to by hand in the place of such a target. Then plants, each sending one subject to by hand mapped to one target: itself, its folder with and without the slash, `tests/`, `.` and `./` (the original or a folder holding it); a scratch folder holding a test file, by its absolute path and by a `../` path, and `../` (outside the checkout); a `byHand` test file and a `byHand` folder (only by-hand test files). Eleven in all. The check lists exactly that file for each, with the why named. Then four plants mapping it to this folder (as `…/`, without the slash, and by absolute path) and to this folder's test file: the check lists nothing. |
| `a test file of the merge base that the checkout no longer holds fails the place check, naming the file` | `#3066.4268aebb` `#3699.4c1cb484` | On this checkout, no test file of the merge base is gone. Then a scratch checkout whose merge base holds `tests/acceptance/<n>/kept.test.mjs` and `deleted.test.mjs`, and whose next commit deletes the second: the check lists exactly that file, `deleted`. |

**Plant subjects come from the live lists.** Each run picks them from this checkout's reading, sorted, so no test pins
today's lane state to a path:

- the files kept, moved to `alone` and sent to by hand: the first five merge-base test files under
  `tests/acceptance/` (outside this folder, and covered by no `redrafted` key, a file's or a folder's) placed in the parallel block on both sides;
- the file moved from `alone` to `parallel`: the first `alone` entry that is one file, placed alone on both sides,
  in no `exclusive` entry and under no other `alone` entry;
- the by-hand-only targets: the first `byHand` entry that is a test file, and the first that is a folder holding one;
- the original's folder targets: the dirname of the subject sent to by hand;
- the scratch suites of `#3699.2b06b98e` and `#3699.4c1cb484`: `tests/acceptance/<n>/`, `n` from 3699 up, the first
  folder no lane list entry or `redrafted` key names or holds, among the next 10,000.

A test fails before planting, naming the counts, when the lists hold too few. What stays fixed: this folder as the
allowed target, its `README.md` and `wrong-checks/` as the file and the folder holding no test file, and
`tests/acceptance/3066-redraft-3699-missing/` as the missing one; each is this folder's own.

## Twins

Line form only (`twins/<name>/lines.json`), each `find` matching one place in the file as the change holds it. Each
but `names-another-failure` replaces the change's `Object.assign(redrafted, …)` line in `scripts/lanes-lists.mjs`.

| Twin | Lays | Fails |
|---|---|---|
| `unmapped` | drops the change's `Object.assign(redrafted, …)` line, keeping its `byHand.push` | `#3699.c037e2f6`, `#3699.79b40a54`, `#3066.4268aebb` |
| `missing-redraft` | maps the first draft to `tests/acceptance/3066-redraft-3699-missing/` | `#3699.c037e2f6`, `#3699.f7548a54`, `#3066.4268aebb` |
| `redraft-holds-no-test` | maps the first draft to this folder's `README.md` | `#3699.c037e2f6`, `#3699.f7548a54`, `#3066.4268aebb` |
| `names-another-failure` | adds one ID under `failures` in `scripts/known-failures.json` | `#3066.4268aebb` (the first test) |
| `maps-to-itself` | maps the first draft to itself | `#3699.c037e2f6`, `#3699.e1f9065f`, `#3066.4268aebb` |
| `maps-to-its-folder` | maps it to `tests/acceptance/3066/` | `#3699.c037e2f6`, `#3699.e1f9065f`, `#3066.4268aebb` |
| `maps-to-tests` | maps it to `tests/` | `#3699.c037e2f6`, `#3699.e1f9065f`, `#3066.4268aebb` |
| `maps-to-checkout` | maps it to `.` | `#3699.c037e2f6`, `#3699.e1f9065f`, `#3066.4268aebb` |
| `maps-outside` | maps it to `../tests/acceptance/3066-redraft-3699/` | `#3699.c037e2f6`, `#3699.e1f9065f`, `#3066.4268aebb` |
| `maps-to-by-hand` | maps it to `tests/acceptance/3295/`, whose one test file runs by hand | `#3699.c037e2f6`, `#3699.e1f9065f`, `#3066.4268aebb` |

Each test fails on its twins at the assertion on this checkout's moves, naming
`tests/acceptance/3066/same-failures.test.mjs`; the first test fails on `names-another-failure` at its `deepEqual`.
On the merge base every test passes (before and after are one tree), so the twins carry the proof.

**No twin for `#3699.2b06b98e` or `#3699.4c1cb484`.** No change outside this folder can make either test's own
assertion on the check fail; only their scene guards. In `#3699.2b06b98e` the scratch checkout reads one `scripts/`
on both sides of one tree, so whatever `lanes-lists.mjs` does, it places the files alike before and after and the
check lists nothing. A change that stops lane files' `timed` or `slow` lists from counting (deleting the
`for (const file of lists?.timed ?? [])` line) fails the guard before it, that the checkout places the files as its
lane file names them. In `#3699.4c1cb484` the deletion is read from the disk, which a line twin can't take a file
from. A change that moves the scratch suite out of the parallel block fails only the guard on the kept file's place.
Those guards say the scene is not the criterion's; they prove nothing about the check, so no such twin is kept.
The wrong programs of these two criteria are this check being wrong, and the check lives under the test paths, where
the before lane lays no wrong program: it runs the change's test code on the merge base, and a twin under
`tests/` is refused. So their stand-in proof is the wrong checks in `wrong-checks/`, each kept in line form
(`<name>.json`, the `find` and `wrong` lines of a twin, applied to this folder's `helpers.mjs`), with its run in
`BASE-RESULTS.txt` run 4. Each is re-run by hand:

```sh
node tests/acceptance/3066-redraft-3699/wrong-checks/lay.mjs <name>
```

`lay.mjs` lays the named wrong check over `helpers.mjs`, runs `same-failures.test.mjs`, puts `helpers.mjs` back as it
was, and exits with the run's status (2 when a `find` doesn't match exactly once). No lane runs it: it is no test
file, and it edits this folder while it runs, so run it only where nothing else reads the folder.

- `before-holds-only-lane-files` (the first draft's before side, `scripts/` and lane files only) fails
  `#3699.2b06b98e` at the check's assertion, naming the timed and slow files (`alone/vitest -> timed/vitest`,
  `-> slow/vitest`); on `673760b70` it fails `#3699.c037e2f6` too, since main's own lane files now name timed files
  (`tests/acceptance/3225/ac7-budget.test.ts`, `tests/acceptance/3569/ac10-budget.test.ts`);
- `skips-deleted` (the first draft's file list) fails `#3699.4c1cb484` at the check's assertion: the deleted file's
  line is missing;
- `no-original-rule` and `no-by-hand-rule` fail `#3699.e1f9065f`, beside its six twins;
- `counts-every-file` (a target's every file counted as a test file) fails `#3699.f7548a54` at the folder plant.

The reviewer judges whether that stands in for a twin.

## Saved output

`BASE-RESULTS.txt`: the file run (1) on the merge base `673760b70`'s `scripts/` with this folder laid in, (2) on the
branch as is, (3) on the branch with each twin laid over it, and (4) on the branch with each wrong check laid over
this folder's `helpers.mjs`.

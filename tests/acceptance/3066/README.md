# Acceptance tests for #3066: the `alone` list by reason

Drafted blind from issue #3066, AGENTS.md, `docs/technical-design.md` (How we know version 0 works),
`docs/parallel-proof.md` (sections 5, 7 and 7a) and the base commit `c7dc0edc3` (origin/main). At the base I also read
`scripts/lanes.mjs`, `scripts/affected.mjs`, `scripts/checks.mjs`, `scripts/proof-runs.mjs`, `scripts/proof-change.mjs`
and `scripts/throttle.mjs`, and `tests/acceptance/1327/`, `1123/`, `2820/` and `1115/` for the conventions. The helpers
are written here, never imported from another suite. Per AGENTS.md the implementing agent doesn't edit these tests; a
dispute goes to a blind redraft by this job.

```sh
npm ci --ignore-scripts                      # once, if node_modules is missing (proof-change.mjs imports typescript)
node --test 'tests/acceptance/3066/*.test.mjs'
```

Offline. It needs git, cargo and a Rust toolchain (one test builds a one-crate workspace with no dependencies). 11 s in
all on the Mac at load 80, most of it `same-failures.test.mjs`, which reads every test file of the merge base twice.
Each scene is removed after its test, and only the processes a test started are stopped, by their process group's PID.

## The shapes these tests expect

The issue leaves these open. Each is the most direct reading I found; a wrong guess shows here.

- **The reason an entry carries.** `scripts/lanes.mjs` keeps exporting `alone`, an array of strings it may be pushed
  to and spliced, and exports **`aloneReasons`**: an object (or a `Map`) from each `alone` entry to its reason, a
  string that is `binary`, `timing`, or `shared` followed by the resource it names (`shared: the sandbox log stream`).
  Text after `binary` or `timing` is allowed. The folders `alone` holds through a `lane.json` (5 on the base) are
  entries too: the counts sum to the list's length only with them, so each has a reason in `aloneReasons`. How a
  `lane.json` folder gets its reason is not tested; no test plants a `lane.json`.
- **`node scripts/lanes.mjs alone --by-reason`** exits 0 and prints, for each reason, at least one count line: the
  reason first (after any table bar, bullet, backtick or space) and its count last (before any table bar or space),
  as `| binary | 120 |` or `timing 31`. Several lines for one reason (`shared` once per resource) are summed. Entry
  lines and a total line may be printed too; a line that ends in a number must not start with a reason unless it is
  a count line.
- **The lint lane** is the `lint` entry of `checks` in `lanes.mjs`. The tests run each of its commands that node runs
  (the same argv, in the scene's folder, side by side) and leave out `cargo fmt` and `cargo clippy`, which read no
  lane list. So the reason check is one of the lane's node commands, it reads `lanes.mjs`'s exports (a plant changes
  them at the end of the module, after anything `lanes.mjs` itself checks while loading), and a refusal is a non-zero
  exit with a line of output that holds the entry (`tests/acceptance/9366`). It is not run through `runLanes`,
  whose throttle and lease would add nothing here.
- **A plant** is a commit in a scene that appends statements to `scripts/lanes.mjs`: `alone.push(entry)` with or
  without `aloneReasons[entry] = reason`, or, for a move, the entry spliced out of `alone` and its reason deleted, as
  a commit that takes its line out leaves the exports. The scene's `origin/main` is the commit before the plant, so a
  check may compare with the merge base. A reason is written only where `lanes.mjs` holds `aloneReasons`, so on the
  base the planted module still loads and each test fails at its assertion.
- **"That run"** (AC2) is read as an `affected.mjs` run whose parallel block holds the moved folder's file with at
  least 4 files beside it. "Fails, naming the folder" is a line of its output that starts `FAIL` or `NEW FAIL` and
  holds the folder's path, with a non-zero exit. The run may stop before its tests or go on to them.

## How the tests reach the code

- **Scenes** (`helpers.mjs`). A scratch git repository in a temp folder: `origin/main` holds a copy of this
  checkout's `scripts/` (`node_modules` linked to this checkout's, ignored by git) and the scene's files, with a HOME,
  TMPDIR and throttle table (`DEEP_THROTTLE_TABLE`) of its own; no `DEEP_*`, `CARGO_*` or `RUSTC*` variable of the
  caller's reaches it.
- **`lanes-read.mjs`** imports a `scripts/` folder's own `lanes.mjs` in a child and prints its lists, `aloneReasons`
  (null when there is none), the lint lane's commands and, given paths, the block `affected.mjs`'s `plan()` puts each
  test file in. It decides nothing itself.
- **This checkout** is read directly for AC1's first sentence and AC4: its own `lanes.mjs`, and its merge base with
  `origin/main` (`git merge-base HEAD origin/main`).

Nothing under test is mocked. cargo and rustc are real.

## Criteria and tests

| Criterion | Tag | Test |
|---|---|---|
| 1. Every `alone` entry carries one of the three reasons, and `--by-reason` prints counts that sum to the list's length. A planted entry with no reason, and one with a fourth reason, each fail the lint lane, naming the entry | `#3066.08445d81` | `by-reason.test.mjs`; `lint-plants.test.mjs` (2 tests) |
| 2. Each entry moved to the parallel block has its wrong program failing there, in a run with at least 4 files beside it, before the commit that removes it from `alone`. A planted move of a folder that still reads `target/debug/<bin>` fails in that run, naming the folder | `#3066.5466dab5` | `moved-run.test.mjs` (second sentence only; see Not tested) |
| 3. No `timing` or `shared` entry moves. A planted move of #236's folder fails the lint lane | `#3066.67d86604` | `lint-plants.test.mjs` (2 tests) |
| 4. The failures on main before and after are the same IDs | `#3066.4268aebb` | `same-failures.test.mjs` (2 tests, proven by a twin) |
| Reading, not a criterion: the alone block's wall time | `#3066.d0eec91f` | none: a reading, saved as output |

### 1. `by-reason.test.mjs`, `lint-plants.test.mjs`

On this checkout: `--by-reason` exits 0, prints a count for each of the three reasons, and the counts sum to
`alone.length`; every `alone` entry has a reason of the three in `aloneReasons` (a `shared` one names its resource);
and the printed counts are the counts of those reasons.

In a scene: an entry planted with the reason `timing` is named by no failing lint command (so a refusal is for the
missing reason alone); then `tests/acceptance/9366/` planted with no reason, and in a second scene
`tests/acceptance/9367/` planted with the reason `habit`, must each be named by a lint command that exits non-zero.

### 2. `moved-run.test.mjs`

The scene has a Cargo workspace of one crate, `deep-hook`, printing a word made for the run, built once into
`target/debug/` as a sibling's build leaves it, and three node suites that `origin/main` runs alone, each planted
with the reason `binary`: `9367/` runs `target/debug/deep-hook`, `9368/` runs `deep-hook` from `DEEP_BIN_DIR`, `9369/`
reads `target/debug/deep-hook` and stays. The change moves `9367/` and `9368/` out of `alone`. The run is
`node scripts/affected.mjs` on those three files and four plain ones, with the lint lane's real scripts.

Asserted: the parallel block holds `9367/`'s file with at least 4 files beside it and the alone block is `9369/`'s
file; a `FAIL` or `NEW FAIL` line names `tests/acceptance/9367/` and the run exits non-zero; no such line names
`9368/` (it moved rightly) or `9369/` (it stays alone, where reading `target/debug` is allowed); and where `9368/`'s
test ran, it ran the run's own build. The bare scene's lint scripts fail for the crates and docs it lacks (1,926
`NEW FAIL` lines on the base); none names a planted file, and a failure message leaves them out.

### 3. `lint-plants.test.mjs`

The scene's lint lane runs before and after a planted move. It is refused when a command that passed before fails
after, or a failing command prints a line naming the entry that it didn't print before. Two moves: #236's folder
(`shared`, the sandbox log stream), and the first `alone` entry of this checkout whose reason reads `timing` and that
`exclusive` doesn't also name. The moved entry's test file is in the scene, so the move takes no file away.

### 4. `same-failures.test.mjs`

"The same IDs" is a reading of two full runs, which no quick test can make. These two hold what makes it true,
between this checkout and its merge base:

- `scripts/known-failures.json`, the list of main's failures, names the same test IDs, lint findings (with their
  counts), timing IDs and skips.
- Every test file the merge base holds (and this checkout still has) is placed by `affected.mjs`'s `plan()` where it
  was, by the same runner: timed, slow, by hand or in a lane of its own as before; the parallel and alone blocks
  count as one place, since an entry leaving `alone` is not a test leaving a lane. Before is the merge base's
  `scripts/` with its `lane.json` files, from `git archive`; after is this checkout's.

## Twins

Both of AC4's tests pass on the base, where before and after are one tree, so the base can't prove them. The
implementer supplies one planted wrong program and names it in `twins.json`:

```json
{ "#3066.4268aebb": ["leaves-a-lane"] }
```

`twins/leaves-a-lane/scripts/lanes.mjs` is the change's `lanes.mjs` with one `alone` folder of the merge base also
named in `byHand` (or `timed`), and `twins/leaves-a-lane/scripts/known-failures.json` is the change's with one more
ID under `failures`. I checked both on a copy of the base (`byHand.push('tests/acceptance/149/')` and one planted ID):
the first test failed on the added ID and the second named 10 of #149's files, each at its `deepEqual`.

## Not tested

- **AC2's first sentence** (each moved entry's wrong program fails in the parallel block, in a run with 4 files beside
  it, before the commit that removes it from `alone`). It is a fact about the change's own history and runs, in a
  form the issue doesn't fix; the trace needs its saved output per moved entry. `moved-run.test.mjs` proves only that
  the run refuses a move that isn't ready.
- **The reading** (the alone block's wall time before and after) gets no test. The issue writes it as a checkbox, so
  the trace lane may list `#3066.d0eec91f` as a criterion with no test.
- That a `binary` entry which still spawns `cargo` is listed for a redraft and stays, and how a `lane.json` folder
  names its reason: scope the criteria don't name.

## On the base

`BASE-FAILURE.txt`: 6 of 8 fail at their assertions; AC4's two pass, as above. Before saving it I checked the tests
can pass: on a scratch copy of the base with a planted fix (`aloneReasons` derived for every entry, a `--by-reason`
table, a lint script that fails an entry without one of the three reasons and a `timing` or `shared` entry of
`origin/main`'s `lanes.mjs` gone from `alone`, and `affected.mjs` refusing a parallel file of a moved entry that reads
`target/debug/`), all 8 passed. The copy was deleted; nothing outside this folder changed.

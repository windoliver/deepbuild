# Acceptance tests for #1981: a budget window measures only the budget tasks a commit can reach

I drafted these tests blind from these sources:

- issue #1981, as saved verbatim for this job, and #1874's body
- `docs/technical-design.md`: How we know version 0 works (Criteria to tests, both ways; Wrong programs; Dogfooding),
  Every task carries its own budgets, The reference Macs
- `docs/parallel-proof.md`, sections 6, 7a, 11, 12 and 12a (12a already describes this issue's behaviour)
- AGENTS.md
- the base commit `3557b348`, which has no implementation: its window runs every task on every commit, and closes an
  issue on #1874's rule

At the base I also read `scripts/budget-window.mjs`, `affected.mjs`, `benchmark.mjs` (`prepareCopy`, `warm`,
`judgeTask`), `lanes.mjs` (`writeRecord`) and `proof-change.mjs`, and `tests/acceptance/1116/` and `1874/`. Per
AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                    # once, if node_modules is missing: affected.mjs imports typescript
node --test tests/acceptance/1981/window.test.mjs
```

One file, three tests, one scene: a fixture repository, two commits, each measured by a real window of its own through
`node scripts/throttle.mjs window` in the fixture's checkout. The scene runs on the first test's turn. On a Mac17,10
(18 cores) at a 1-minute load of 370 to 650 from other sessions, it took 10 to 14 minutes against my throwaway window
and the twins, which make 192 task runs, and 24 against the base, which runs every task: 480 runs.

The sandbox, the fixture and the stand-ins (`gh`, the fingerprint tools, the pinned load, `npm`) are #1116's, imported
unchanged from `../1116/helpers.mjs`; the issue bodies, criterion IDs and timeouts are #1874's, from
`../1874/helpers.mjs`. Every process gets a temporary `HOME`, `XDG_CACHE_HOME` and `TMPDIR`. `helpers.mjs` here adds
what the selection needs to run in the sandbox, the fixture's workspace and tasks, and the samples per window.

## What lets the selection run in the fixture

A right window runs `affected.mjs`'s selection, which reads the workspace's crates with `cargo metadata --no-deps
--format-version 1 --offline` and imports `typescript`. #1116's sandbox has neither: its `cargo` exits 0 printing
nothing, and `RUSTUP_HOME` is an empty folder. `selectable(box)` settles both:

- **`cargo`**, first on `PATH`, replaces #1116's stand-in in the sandbox's `bin/`. `cargo metadata …` runs the real
  cargo (`rustup which cargo` from this checkout, else `cargo` on `PATH`) with the real `RUSTUP_HOME`, so the graph
  holds the fixture's real manifests. `cargo build`, `test` or `clippy` (`warm` runs the last two) install deep-hook's
  binary where cargo would, `$CARGO_TARGET_DIR/debug/deep-hook`, else `./target/debug/deep-hook`: a `/bin/sh` script of
  #1116's workload and one sample. Anything else exits 0.
- **`node_modules`**: this checkout's is linked as the sandbox folder's own `node_modules`, above the fixture's
  checkout and above `~/.deepbuild/budget-window/<side>/copy`, so `typescript` resolves from either tree's
  `scripts/affected.mjs`. No tree holds the link, so `git ls-files` never lists it.

On the base, in the fixture's checkout with the sandbox's environment, `node scripts/affected.mjs --list
crates/deep-hook/src/main.rs` exits 0 printing `parallel cargo test: deep-hook` (`BASE-FAILURE.txt`).

## The surface (my choice where the issue leaves it open)

Everything in `../1116/README.md` and `../1874/README.md`, "The surface", stays: how a window opens, the mark, the
record's place and shape, `criteria` on a task, `unmeasured`, `Part of #n`, closing, and the `gh` calls. #1981 adds one
thing to the record, and names no field.

- **`notReached` on a commit's record**: a list of task IDs, one for each task of `benchmarks/budgets.json` the window
  didn't run on that commit because the commit can't reach it. It sits beside `commit`, `base` and `unmeasured`.
  `tests` holds a row for each task the window ran and none for a task not reached, so such a task is never PASS. A
  record that reached every task may leave the field out or hold an empty list.

  ```json
  { "lane": "budget-window <sha>", "state": "PASS", "tests": [{ "id": "hook-version", "state": "PASS" }, …],
    "commit": "<sha>", "base": "<sha>", "unmeasured": ["#9501.…"], "notReached": ["canvas-patch", "canvas-seal"] }
  ```

  I chose a list beside `unmeasured` over a row with a new state, so `tests` keeps the five verdicts and a record whose
  tasks run all pass can still close an issue on the criteria they measured. No test reads the record's `state`.
- **What reaches a task.** The tests don't say how a task is placed in the graph. They hold that a commit changing only
  `crates/deep-hook/src/main.rs` reaches a task whose command is the crate's binary and a task whose command is a
  script naming the binary, and no task whose command is a script naming neither; and that a command naming no file of
  the tree and no crate's binary is one the selection can't place.
- **The fixture's five tasks**, set by one commit before the first window's mark, so both sides of every measured
  commit hold them. The last argument of each command is the task's own ID, which its program writes into its sample.

  | Task | Command | Placed by |
  |---|---|---|
  | `hook-version` | `target/debug/deep-hook hook-version` | the crate's binary, as the real `target/debug/deep-hook --version` task |
  | `hook-overhead` | `node benchmarks/deep-hook.mjs hook-overhead` | a script that runs `new URL('../target/debug/deep-hook', import.meta.url)`, as the real `benchmarks/deep-hook.mjs` tasks |
  | `canvas-patch`, `canvas-seal` | `node benchmarks/canvas.mjs <id>` | a script that imports nothing and runs nothing |
  | `loose` | `node -e '<inline code>' loose` | nothing: no file of the tree and no crate's binary. **This is the task the selection can't place** |

  `canvas-seal` names one criterion, as #1874's `criteria`: the only unticked line of issue 9501.
- **Samples.** Each program appends one line per run to the test's events file, at an absolute path baked in when the
  fixture is written: `{ "kind": "sample", "task": "<id>", "cwd": "…" }`. Each window measures one commit, so the
  samples written while it ran are that commit's.

The tests enter only through `throttle.mjs window`, the record files under `~/.deepbuild/lanes/`, the stand-in `gh`'s
state and the samples. They import no script.

## Criteria to tests

| Criterion | Test (`window.test.mjs`) | What it requires |
|---|---|---|
| AC1 `#1981.91e6703b` A fixture commit that changes only `crates/deep-hook` runs the tasks whose commands run deep-hook's binary and no task that runs only `benchmarks/canvas.mjs`, and its record lists each task not run as not reached. A planted window that runs every task fails, naming a task the commit can't reach | `#1981.91e6703b a fixture commit that changes only crates/deep-hook runs …` | On the `hook` commit's window, `hook-version` and `hook-overhead` wrote samples and their rows are PASS; `canvas-patch` and `canvas-seal` wrote none. `notReached` is exactly the tasks that wrote no sample, and none of them has a PASS row |
| AC2 `#1981.a6a21922` A task whose command `affected.mjs` can't place runs on a fixture commit that changes an unrelated file. A planted window that skips it fails, naming the task | `#1981.a6a21922 a task whose command affected.mjs can't place runs …` | On the `notes` commit's window, `loose` wrote samples and its row is PASS |
| AC3 `#1981.2eb85d5e` A fixture commit naming an issue whose only budget criterion is measured by a task the commit didn't reach leaves that issue open, its record naming the task as not reached. A planted window that closes it fails, naming the issue | `#1981.2eb85d5e a fixture commit naming an issue whose only budget criterion …` | Every row of the `hook` commit's record is PASS, issue 9501 is OPEN, and `notReached` holds `canvas-seal` |

Each test first requires the commit's record, so a window that did nothing fails all three.

## The scene

```
r0 ─ r1 ─ workspace ─ hook ─ notes      main; the first window marks workspace, then one window per commit
```

| Commit | Changes | Message | A right window runs |
|---|---|---|---|
| `workspace` | `Cargo.toml` (a workspace), `crates/deep-hook/{Cargo.toml,src/main.rs}`, `benchmarks/{canvas,deep-hook}.mjs`, `benchmarks/budgets.json` (the five tasks) | | nothing: it's marked, never measured |
| `hook` | `crates/deep-hook/src/main.rs` only | `Part of #9501` | `hook-version`, `hook-overhead`, `loose` |
| `notes` | `docs/notes.txt` only, a file no task reads | `Part of #9502` | `loose` |

Issue 9501 has a `### Acceptance criteria` section with one ticked line and one unticked line, ``
`canvas-seal` stays within its p50 budget on a reference Mac ``, which `canvas-seal` names. Issue 9502 has no criteria.
Neither commit adds a `tags/` file of #1116's, so `hook` changes only `crates/deep-hook`.

## Wrong programs

AC1 and AC3 fail on the base at an assertion: the base's window is AC1's "planted window that runs every task", and,
having run `canvas-seal`, it closes 9501 too, as AC3's "planted window that closes it" (`BASE-FAILURE.txt`). AC2 passes
on the base, which runs every task, so it has a twin. AC1's and AC3's base failures come before their record lines are
read, so those lines have a twin; and AC3 has a second, which closes the issue without running the task, the way a
selection added beside #1874's `named` could.

| Criterion | Twin | The planted fault |
|---|---|---|
| `#1981.91e6703b` (AC1), `#1981.2eb85d5e` (AC3) | `silent-record` | The window runs only the tasks a commit reaches, and the record never lists the others |
| `#1981.a6a21922` (AC2) | `skips-unplaced` | A task whose command the selection can't place never runs |
| `#1981.2eb85d5e` (AC3) | `closes-unreached` | Every task's criteria count as measured, run or not, so the issue closes |

Each twin is `twins/<name>/scripts/budget-window.mjs`: a whole window, my throwaway with one line changed, importing
only `./affected.mjs`, `./benchmark.mjs`, `./lanes.mjs`, `./proof-change.mjs` and `./throttle.mjs` beside it. The
throwaway is the base's window plus about 30 lines: each task stands in the selection as a test of its own that imports
its script or names its binary, and `select` decides which run. It passes the three tests and isn't kept. A twin goes
stale as the real file changes, and still holds its fault.

## Readings where the issue leaves a choice

- **"Lists each task not run as not reached".** Read against the samples: the record's `notReached` is exactly the
  fixture's tasks that wrote no sample in the commit's window. A window that lists a task it ran, or leaves out one it
  didn't, fails.
- **"Runs".** A task ran when its own program wrote samples in the commit's window and its row is PASS, so a window
  that writes a row without running the command fails.
- **AC3's issue.** It's named by the AC1 commit: `canvas-seal` is a task that commit can't reach. AC3 requires every
  task run on that commit to pass first, so only the unreached task can keep the issue open.
- **"The record naming the task as not reached"** (AC3) is the same `notReached` list. The Scope's "named as
  unmeasured" (the criterion in `unmeasured`) isn't in a criterion, so no test reads it.
- **"On the reference Mac".** The helpers stand in a Mac15,7 on mains and pin the load each process reads, as #1116's
  suite does, so the limits are judged and a PASS is reachable on any Mac.

## Known limits

- Both sides of every commit hold the same tasks, so no test decides whether placement reads the commit's tree or its
  merge base's.
- No test has a task the selection marks wide, a commit longer than any cap, or the signed approval tag. No criterion
  holds them as a fixture commit.
- deep-hook's binary is a shell script the stand-in cargo installs, never built from `src/main.rs`; the tests read
  which tasks ran, not what the binary does.
- The window's copy step at the base (`git archive` piped into `tar -mxf -` in `copyOf`) can end in `spawnSync tar
  EPIPE` on a heavily loaded Mac, and the commit's record is then BLOCKED. My first base run met it on the `hook`
  commit at a load near 400 (`BASE-FAILURE.txt`); ten tries of the same pipe on that commit at that load didn't. It is
  the base's, and fails AC1 and AC3 at their first assertion whatever the window selects.

## What the implementer meets outside this folder

- `../1116/` and `../1874/` measure commits that each change only a `tags/<name>` file, which reaches no task. Their one
  task, `fixture-bench` (`node bench.mjs`), names a file of the tree, so with this issue it isn't run on those commits,
  and their tests that require its PASS row would fail. They need blind redrafts by an approved proposal.
- `budget-window.mjs` is on the guard's list, so the PR carries a signed approval tag.

## Files

- `window.test.mjs`: the scene and AC1 to AC3.
- `helpers.mjs`: the task IDs, `selectable`, `workspace`, `commit`, `windowOn`, `ran` and `row`.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the selection in the fixture on the base, and the run on the base, the throwaway and each twin.

No fixture holds a secret or personal data. Issues 9501 and 9502 are made up.

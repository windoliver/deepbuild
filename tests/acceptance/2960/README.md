# #2960 acceptance: the perf lane counts a child that ends with `_exit`, and counts on Linux

Written blind from the issue (#2960: What happens, What would prove a budget's instructions, its four checkbox
criteria, Notes), the design (Numbers version 0 has to hold; Wrong programs; Criteria in a checked shape; The edit
guard; Dogfooding) and base `dcb63a0a0`. Read at the base: `scripts/count-children.c`, `scripts/benchmark.mjs`
(`counterBuild`, `measureOnce`, `countChildren`, `parseInstructions`, `judgeInstructions`),
`packages/supervisor/native/helper.c` (`leash`), the four tasks in `benchmarks/budgets.json`, and
`tests/acceptance/2646/` for shape. No implementation was seen. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.


> **AC1 (`#2960.bb693bcf`) moved to `tests/acceptance/2960-redraft-ac1/` (2026-11-21).** The maintainer settled the
> dispute for the blind redraft: `exit-counted.test.mjs` measured before building, so on a cold checkout the floor compiled
> inside a measured run and read null. It and its twin `counter-ignores-exit` are removed; the rows below that name them
> are kept as written, for the record.

## Criteria

| ID | Criterion (in full) |
|---|---|
| `#2960.bb693bcf` | On macOS, `measureOnce` of `deep-hook-guards`, `deep-hook-overhead`, `hub-round-trip` and `extension-host` at the merge base each give a non-null instruction count with an empty `uncounted`. A planted counter that ignores `_exit` reads `uncounted ["(forked)"]` again, and the test fails naming the helper's watcher. |
| `#2960.3979694e` | A child that is SIGKILLed before it ends still leaves the run's count null, naming it (no count is invented for a process that never reported). |
| `#2960.5567ea2d` | On Linux with instruction counting allowed, the same four tasks give non-null counts that include their children. With `perf_event_paranoid` forbidding it, each reads BLOCKED and names the setting. |
| `#2960.e48f6fa4` | A count run through an x86_64 cargo or a translated shell reads BLOCKED naming which binary, not a dyld abort. |

IDs are `scripts/proof-change.mjs`'s `criterionId` of each checkbox's text.

## Run

The checkout the tests run from is built (`npm ci && npm run build --workspaces`), with `cargo build -p deep-hook`
and `cargo build --release -p deep-hook` done (the hub and `benchmarks/deep-hook.mjs` need them). PATH must reach a
**native arm64 cargo first**: `benchmarks/deep-hook.mjs` runs `cargo build` inside the measured run, and an x86_64
rustup proxy there is criterion 4's case, not criterion 1's.

```
node --test tests/acceptance/2960/killed-child.test.mjs     # macOS, seconds
node --test tests/acceptance/2960/x86-blocked.test.mjs      # Apple silicon Mac with Rosetta, seconds
node --test tests/acceptance/2960/exit-counted.test.mjs     # macOS, minutes: four budget tasks, each counted once
node --test tests/acceptance/2960/linux-counter.test.mjs    # Linux (ssh spark); every test skips on macOS
```

`DEEP_2960_BASE=<a built checkout of the merge base>` makes the four tasks of criteria 1 and 3 run in that checkout
("at the merge base"), measured by this checkout's `measureOnce`; without it they run in this checkout, which is the
same program when the change touches only the lane's code, as the issue's does. Fixture programs (`fixtures/*.c`) are
built with `cc` into `/tmp/dh2960-*` and removed. Nothing is killed by name or port; no system setting is changed.

## Requirement, check, proof

Every reading is `measureOnce(command, cwd, false, 1_200_000)` of this checkout's `scripts/benchmark.mjs`, the
surface the issue names (a 20-minute capture limit instead of the lane's 5 minutes, so a loaded Mac reads a count,
not a timeout). "BLOCKED" is read from what `measureOnce` throws, as it already throws `BLOCKED: native peak RSS
requires macOS or Linux`, or from a returned result whose own fields (not the command's output) say BLOCKED and hold
no count (`lib.mjs` `blockedNaming`).

| Criterion | Test | Asserts |
|---|---|---|
| `#2960.bb693bcf` | `exit-counted.test.mjs`: one test of the helper's watcher, then one per task | **Watcher:** a node process that runs `packages/supervisor/dist/helper leash /usr/bin/true`, waits for it and stays 3 s, exits 0 with a positive count and an empty `uncounted`. A control (the same process running `/usr/bin/true` alone) must be counted first, so a `"(forked)"` in the leash run is the helper's watcher, and the failure says so: `the supervisor helper's leash watcher (… leash(): forked beside the program, ends with _exit(0), never waited for) has no count …`. **Tasks:** for each of `deep-hook-guards`, `deep-hook-overhead`, `hub-round-trip`, `extension-host`, its `benchmarks/budgets.json` command exits 0 with a positive safe-integer count and `uncounted` `[]`. |
| `#2960.3979694e` | `killed-child.test.mjs` (two tests) | `fixtures/killer.c` starts one child, SIGKILLs it before it ends and exits 0 without waiting for it. For a `posix_spawn` child (`fixtures/tool.c` in `pause` mode) the run's instructions are `null` and `uncounted` holds the child's path; for a forked child, `null` and `"(forked)"`. Both children are programs the library enters, so the killed one is the only reason for no report. |
| `#2960.5567ea2d` | `linux-counter.test.mjs`: one test per task, one of children | Allowed (root, or `/proc/sys/kernel/perf_event_paranoid` ≤ 2): each task exits 0 with a positive count; and a node process that runs a child doing about 10⁹ instructions of work counts more than that child counted alone (the children are included). Forbidding (above 2): each task's reading is BLOCKED and names `perf_event_paranoid`, with no count. On macOS every test skips, `INCONCLUSIVE: criterion #2960.5567ea2d is Linux's`. |
| `#2960.e48f6fa4` | `x86-blocked.test.mjs` (three tests) | (a) an x86_64-only program named `cargo`, built here from `fixtures/tool.c`: BLOCKED naming it (its path or `cargo`). (b) This Mac's `~/.cargo/bin/cargo` when it is an x86_64-only rustup proxy (skips with a reason otherwise): BLOCKED naming it (its path, `cargo`, or what it links to, `rustup`). (c) `probe.mjs` started from `arch -x86_64 /bin/sh` (checked translated: `sysctl.proc_translated` 1), measuring a universal `universal-tool` that therefore starts as x86_64: BLOCKED naming `universal-tool` (its path or name) or `/bin/sh`. Skips off Apple silicon or without Rosetta. |

A test that can't reach its observable (a checkout not built, a task that exits non-zero, an uncounted control)
fails with BLOCKED at the head of its message; none passes.

## Planted programs (twins.json)

Both are whole-file twins laid over the change, as the before lane lays `tests/acceptance/<n>/twins/<name>/<path>`.

- **`counter-ignores-exit`** (`#2960.bb693bcf`): `scripts/count-children.c` exactly as at the base, which writes a
  process's `exit` line only from a destructor, so `_exit` writes none. On it, the change's `measureOnce` reads the
  watcher as `uncounted ["(forked)"]` again and `exit-counted.test.mjs` fails, the leash test naming the helper's
  watcher. Wiring: none beyond the change keeping `count-children.c` the counter `counterBuild` builds and
  `countChildren` reading the base's line format (`start`, `reap`, `unread`, `exit`). If the change moves the counter
  or changes its log so the base's source no longer builds or reads, this twin reads BLOCKED and needs a redraft.
- **`count-forgets-killed`** (`#2960.3979694e`): `scripts/benchmark.mjs` as at the base with one line of
  `countChildren` removed, the one that names a started child with no end (`...starts.filter(({ child }) =>
  !ended.has(child))…`). It invents a count from the rest. Checked here: on it both `killed-child` tests fail
  (`the run's count is 21749979, a count invented for a child that was SIGKILLed and never reported`). It is the
  base's file, not the change's: the tests it serves are macOS's, where the base's `measureOnce` runs, and it needs
  the change's `count-children.c` to keep the base's log format.

Criterion 2 holds on the merge base already (the condition must keep holding), so its tests pass there: their wrong
program is the twin. Criteria 1 and 4 fail on the merge base. Criterion 3's wrong program is the merge base, on Linux.

## On the unchanged base (BASE-FAILURE.txt)

- `exit-counted`: the leash test FAILs naming the helper's watcher (`reads instructions null, uncounted ["(forked)"]`,
  where the control reads a count). The tasks FAIL with `instructions null`, `uncounted` holding `"(forked)"` (and,
  for `extension-host`, the helper itself; for `hub-round-trip`, `/usr/bin/sandbox-exec`; for `deep-hook-overhead`,
  `a child of (forked)`), as the issue reads them. A scratch counter interposing `_exit` (not committed) passes the
  leash test and `deep-hook-guards`; `extension-host` then still names the helper itself.
- `killed-child`: PASS, as it should (see above); FAIL on `count-forgets-killed`.
- `x86-blocked`: all three FAIL: `measureOnce returned {"status":null,"instructions":2…e7,"uncounted":[]}` with
  dyld's `incompatible architecture (have 'arm64', need 'x86_64')` and `time: command terminated abnormally` — a dyld
  abort read as a count, never BLOCKED.
- `linux-counter`: on this Mac, skipped (INCONCLUSIVE). On Linux the base gives `instructions null` with no BLOCKED
  in both halves (`counterBuild` is null off darwin), so every test there fails. Not run on Linux by this job.

## Not named by the issue, so chosen

- **The planted counter's name and how it is selected**: the twin `counter-ignores-exit`, the base's counter source,
  selected by the before lane's twins, never by an environment variable (design: Wrong programs).
- **"Naming the helper's watcher"**: `uncounted` names only `"(forked)"`, so the leash test makes the watcher the only
  forked child (a counted control beside it) and its failure names it. The task tests' failures add the same note when
  `"(forked)"` is among their uncounted.
- **"At the merge base"**: the tasks' programs as the merge base has them, measured by the change's lane:
  `DEEP_2960_BASE` when set, else this checkout.
- **BLOCKED's shape**: thrown by `measureOnce` or held in its result with no count, with the binary's or setting's
  name anywhere in that text. No exact wording is asserted.
- **"Forbidding"**: `perf_event_paranoid` above 2 for a process not running as root. At 2 a process may count its own
  user-space instructions, so 2 is "allowed".
- **"Include their children"** on Linux: shown on a child of known work, not on the tasks, whose own processes can't be
  counted apart from their children through `measureOnce`.
- **"Which binary" for a translated shell**: either the universal program that started as x86_64 or the shell.
- **The x86_64 cargo**: an x86_64-only program named `cargo` (any Apple silicon Mac with Rosetta), and this Mac's real
  rustup proxy when present.

## Open questions

- **Criterion 2 on Linux.** A counter that follows descendants (`perf_event_open` with `inherit`, the issue's own
  example) adds a SIGKILLed child's instructions as it ends, so "a process that never reported" may not exist there.
  `killed-child.test.mjs` runs on macOS only and skips elsewhere with that reason.
- **Criterion 3 was not run.** The Spark has `perf_event_paranoid` 4, so only the forbidding half can run there until
  its owner lowers it; the allowed half needs a host that allows counting.
- **`hub-round-trip`'s `/usr/bin/sandbox-exec`** (issue, What would prove, item 0) is part of criterion 1's empty
  `uncounted`; these tests hold it to that and don't say how.

## Outside this folder, for the implementer

- `scripts/lanes.mjs`: `alone` could list `tests/acceptance/2960/`: `exit-counted.test.mjs` and
  `linux-counter.test.mjs` count four budget tasks (minutes each, and their hubs and hook calls shouldn't share the
  machine with other files'); `killed-child.test.mjs` and `x86-blocked.test.mjs` take seconds. Not edited here (a
  `lanes.mjs` edit needs the maintainer's signed tag).
- The change itself: `count-children.c` interposing `_exit`/`_Exit` (or any other way the watcher's end is counted),
  the Linux counter behind `counterBuild`/`parseInstructions`, the BLOCKED readings for an x86_64 binary or a
  translated run, and whatever `hub-round-trip`'s `sandbox-exec` and `extension-host`'s helper need for an empty
  `uncounted`.
- `benchmarks/budgets.json`: the four tasks could carry `"criteria": ["#2960.bb693bcf"]`; not required by these tests.

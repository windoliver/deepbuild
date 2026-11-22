# Acceptance tests for #2784: busy_disk's second test loads the disk on Linux, and doesn't pass when it didn't

I drafted these tests blind from these sources:

- issue #2784, as given verbatim to this job
- `docs/technical-design.md`, "How we know version 0 works" and Dogfooding (`node scripts/design-section.mjs --issue 2784`)
- AGENTS.md
- the base commit `2eaaeb0e6`, which has no implementation

At the base I also read `crates/deep-hook/tests/busy_disk.rs`, deep-hook's `spool` (how it starts `deep-hook
spool-sync <folder> <upto>` in `crates/deep-hook/src/main.rs`), `scripts/affected.mjs` (`classify`, how it prints what
it read), `scripts/lanes.mjs` (`cargoResults`, `crates`, `readSkips`), `scripts/proof-change.mjs` (criterion IDs) and
`tests/acceptance/2179/`, whose conventions and surface these tests follow. Per AGENTS.md, the implementing agent
doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
node --test tests/acceptance/2784/busy-disk-writers.test.mjs
```

The first run builds busy_disk and deep-hook into `target/acceptance-2784/` (a few minutes from cold here); each test
then runs for a few seconds, most of it the test's own waits of 300 to 1500 ms before each burst. Run it in a
memory-capped unit on the Spark, as every cargo build there.

## Criteria to tests

Each criterion's ID is `#2784.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`, `readIssue`) works it out, from the issue text as given to
this job. Each test carries its tag at the start of its name. All of them run busy_disk's second test,
`hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running`.

| Criterion | Test (`busy-disk-writers.test.mjs`) | What it requires |
|---|---|---|
| AC1 `#2784.3c3e909f` On Linux the writers really write | `AC1 #2784.3c3e909f …` | With the machine's GNU dd judging each writer's operands: GNU dd accepts every writer's operands (opens its file, refuses no number); the operands ask for at least 1 GB (10^9 bytes) per writer, as GNU dd counts them; each writer's file ends that size; each burst starts four writers, each with a file of its own, before its hooks; every hook (the real deep-hook) has its line in the spool folder when it exits; and affected.mjs's reading of the run is a result (PASS or NEW FAIL), never INCONCLUSIVE or BLOCKED |
| AC2 `#2784.bc2bd4cc` Writers that wrote nothing read INCONCLUSIVE | `AC2 #2784.bc2bd4cc … given a dd that fails …` and `… given a dd that writes nothing …` | With a dd that exits 1 saying GNU dd's `invalid number: '1m'` and writing nothing, and, separately, one that exits 0 leaving its file empty: affected.mjs prints an INCONCLUSIVE line for busy_disk whose text, besides the test's name, names its reason (dd, writing, the load, the disk not busy, or that it proves nothing). It is not a PASS, not a NEW FAIL and not a KNOWN failure |
| AC3 `#2784.71e24b92` More than three syncs left behind still fails the test | `AC3 #2784.71e24b92 …` | When each of the burst's hooks leaves a process whose arguments are `spool-sync <the run's spool folder>` running, the run reads NEW FAIL (state FAIL) for busy_disk, never INCONCLUSIVE and never PASS |

## How each condition is made

The tests build the real `busy_disk.rs` with `cargo test --locked -p deep-hook --test busy_disk --no-run
--target-dir target/acceptance-2784`, keep a copy of the real `debug/deep-hook` cargo linked (as
`target/acceptance-2784/real-deep-hook-2784`), then run cargo's built test binary as `cargo test` would, from
`crates/deep-hook`, filtered to the second test, with stdout and stderr on one descriptor after the `Running
tests/busy_disk.rs (<binary>)` line cargo prints, as `tests/acceptance/2179/` does and for its reason (`cargo test`
re-links `debug/deep-hook` over the stand-in). Two stand-ins:

- **`dd`, first on the test's PATH.** busy_disk starts `dd` by name from its own environment.
  - AC1 and AC3, *GNU dd's judgment without its load*: a script that runs the machine's GNU dd (the `dd` on PATH,
    checked to be coreutils', else every test is BLOCKED) twice on the test's own operands. First as they are, with
    `count=` set to 0: GNU dd parses every operand and opens the `of=` file, refusing what it refuses (the base's
    `bs=1m` gives `invalid number: '1m'`), and writes nothing. Then with the output to `/dev/null` (and `of=`, `conv=`,
    `oflag=`, `seek=` and `status=` dropped), so GNU dd itself counts the bytes the operands ask for. When both
    succeed it gives the writer's file that size, sparse, and exits 0 with GNU dd's own report on stderr; otherwise
    it exits 1 with GNU dd's message. It logs each writer's operands, GNU dd's answer, the bytes and the file's size.
  - AC2, *writers that wrote nothing*: one that prints `dd: invalid number: '1m'` and exits 1, and one that empties
    its `of=` file, prints a 0-bytes report and exits 0.
- **The deep-hook the test spawns,** `env!("CARGO_BIN_EXE_deep-hook")`, for this suite `target/acceptance-2784/debug/deep-hook`.
  The test removes that file after the build (cargo's copy in `deps/` stays) and writes a script in its place. The
  hook's environment is cleared to `HOME` alone, so each script's paths are written into its text:
  - AC1: a wrapper that runs the real deep-hook copy with the same arguments and stdin, then logs its status and how
    many files `$HOME/.deepbuild/spool` holds. The real hook's syncs run as `real-deep-hook-2784 spool-sync <folder>
    <upto>`, which busy_disk counts as it counts the real ones.
  - AC2: a hook that reads its stdin and exits 0, leaving nothing running.
  - AC3: a hook that starts `node -e 'setTimeout(…, 120000)' spool-sync "$HOME/.deepbuild/spool"` in the background,
    logs its PID, waits until `/proc/<pid>/cmdline` names `spool-sync`, and exits 0. Twenty of those are twenty lines
    of `ps -Ao args=` containing `spool-sync <folder>`, so the first burst leaves 20 syncs behind. The test kills
    each logged PID after the run, by PID.

Both stand-ins append `D` (a writer started) or `H` (a hook started) to one event log, which AC1 reads for the order.
Each test checks that the stand-in hook was still in place after the run and that busy_disk ran it; either missing
fails as `BLOCKED: …`.

Why GNU dd's judgment and not the real 4 GB load: the real load writes four 1 GB files up to four times, 16 GB, and
its timing depends on the machine's own disk, which the criterion isn't about. What AC1 says is that, given GNU dd,
each writer's file is written: that is decided by whether GNU dd accepts the operands and how much they ask for,
which the stand-in has GNU dd itself decide on the test's exact operands. The load itself (the bytes really reaching
the disk) is left to the issue's Proof run, the implementing job's to save. Why the real hook in AC1: "the hooks spool
against that load" is the real hook's behaviour; with the stand-in's light load it is not expected to leave more than
three syncs, but AC1 accepts PASS or NEW FAIL, so a busy machine's real late syncs don't decide it.

## The surface, and the seams assumed

`affected.mjs`'s reading of a cargo job is reached through its public entries, `scripts/affected.mjs` (`cargoResults`,
`crates`, `classify`) and `scripts/lanes.mjs` (`readSkips`, `timed`), the functions its `main` calls on the job's
log: `cargoResults(output, status, crates(root))`, then `readSkips` against `scripts/known-failures.json`'s `skips`,
then `classify` at load 0. Running the whole `node scripts/affected.mjs` for a path under `crates/deep-hook` would
select hundreds of other suites, so that reading is the one taken, as in #2179's suite. Each test prints the lines
`affected.mjs` would print for it (`INCONCLUSIVE <id>: <reason>`, `NEW FAIL <id>`, `KNOWN`, `LISTED`, `PASS`) as
diagnostics.

The seams assumed, all already at the base: busy_disk's second test is named
`hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running` in the `busy_disk` test target and is
chosen by that name as the binary's first argument; it starts its writers as `dd` by name from its PATH with an
`of=<file>` and a `count=` operand; it spawns the deep-hook at its `CARGO_BIN_EXE_deep-hook` path with `HOME` alone; it
counts leftover syncs as lines of `ps -Ao args=` containing `spool-sync <HOME>/.deepbuild/spool`; its runs read
INCONCLUSIVE by the route #2179 added (`test result: INCONCLUSIVE. <name>: <reason>`, which `cargoResults` reads). A
fix that renames the test, starts dd another way (by absolute path, or without `count=`) or counts syncs another way
needs a redraft. The test ID is matched by `busy_disk` in it, so the reading may name the test or its target.

## Wrong programs each test fails on

- AC1: the base commit. Its writers' `bs=1m` is refused by GNU dd (`dd: invalid number: '1m'`) for all 16 writers
  (`BASE-FAILURE.txt`). It also fails on a program whose writers ask for less than 1 GB, start fewer than four or share
  a file, start the hooks before the writers, or that reads a run with written writers as INCONCLUSIVE.
- AC2, both cases: the base commit, which never checks its writers and reads both runs `ok`, so affected.mjs says
  `PASS` (`BASE-FAILURE.txt`). Also a program that checks dd's status only (fails the "writes nothing" case), one that
  checks only whether the file exists (the same), and one that panics on a failed writer (NEW FAIL, not INCONCLUSIVE).
- AC3 passes at the base, which is right: 20 syncs left behind fail `most <= 3`, read as NEW FAIL. It is kept as the
  criterion's proof and as regression protection for the fix. It fails on a program that drops or weakens the bound,
  counts syncs by something the leftover processes don't match, or reads a run with syncs left behind as INCONCLUSIVE
  (for instance by checking writers after the count and letting that outrank it). None of these was run: each would be
  an edit to `busy_disk.rs` or `lanes.mjs`, outside this folder.

## Not covered here

The issue's Scope also asks the test to say what it writes (four files of 1 GB under `/tmp`, up to four times). That
is not an acceptance criterion and is a matter for the diff's review. The issue's Proof asks for the test's output on
Linux before and after with the real load; that run needs a real disk and is the implementing job's to save.

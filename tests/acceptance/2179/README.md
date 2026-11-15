# Acceptance tests for #2179: busy_disk reads INCONCLUSIVE when the disk isn't busy, never as a failed test

I drafted these tests blind from these sources:

- issue #2179, as given verbatim to this job
- `docs/technical-design.md`, "How we know version 0 works" and Dogfooding
- AGENTS.md
- the base commit `c740dede7`, which has no implementation

At the base I also read `crates/deep-hook/tests/busy_disk.rs`, the spool and sync code in
`crates/deep-hook/src/main.rs`, `scripts/affected.mjs` (its cargo job and how it prints what it read),
`scripts/lanes.mjs` (`cargoResults`, `readSkips`, `readRun`, `runLanes`) and `tests/acceptance/1115/` and `315/` for
their conventions. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by
this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
node --test tests/acceptance/2179/busy-disk.test.mjs
```

The first run builds busy_disk and deep-hook into `target/acceptance-2179/` (about a minute here); each test then runs
for about 20 s, most of it the test's own 300 ms wait before each of its 60 calls.

## Criteria to tests

Each criterion's ID is `#2179.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` works it out, from the issue text as given to this job. Each test carries
its tag at the start of its name.

| Criterion | Test (`busy-disk.test.mjs`) | What it requires |
|---|---|---|
| AC1 `#2179.c2c274c4` A quiet disk reads INCONCLUSIVE | `AC1 #2179.c2c274c4 …` | On a disk where no call's spooled line outlasts the deadline, `a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms` as cargo runs it, read as `affected.mjs` reads its cargo job, gives an INCONCLUSIVE line for busy_disk whose reason names the disk not being busy, the syncs that outlasted the deadline, or that it proves nothing. It is not a NEW FAIL, not a KNOWN failure, and not a PASS |
| AC2 `#2179.bbec3c91` A hook that takes more than 50 ms with its line still syncing still fails the test | `AC2 #2179.bbec3c91 …` | When every call says its spooled line's sync outlasted the deadline and takes 200 ms, the same test, read the same way, is a NEW FAIL for busy_disk, never INCONCLUSIVE and never PASS |

## How each condition is made

Both tests build the real `busy_disk.rs` with `cargo test --locked -p deep-hook --test busy_disk --no-run
--target-dir target/acceptance-2179`, then run the test binary cargo built, as `cargo test` would: from
`crates/deep-hook`, filtered to `a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms`, with stdout and stderr
on one descriptor after the `Running tests/busy_disk.rs (<binary>)` line cargo prints, so the log has the shape of
`affected.mjs`'s cargo job. They don't run `cargo test` itself after the build: at the base it re-links
`debug/deep-hook` before starting the test, which replaced the stand-in below (`BASE-FAILURE.txt`). Nothing depends on how busy the real disk is:

- **`dd`, first on the test's PATH.** busy_disk starts `dd` by name from its own environment. The stand-in writes
  nothing and exits 0, so no run writes 60 files of 512 MB under `/tmp` and no outside load reaches the result. (On this
  machine the base's `dd ... bs=1m` doesn't write either: GNU dd exits with `invalid number: '1m'`. The stand-in keeps
  the condition the same once a fix spells it as GNU dd accepts.)
- **The deep-hook the test spawns.** busy_disk spawns `env!("CARGO_BIN_EXE_deep-hook")`, which for this suite's own
  target folder is `target/acceptance-2179/debug/deep-hook`. After the build, the test removes that file (cargo's copy
  in `deps/` stays) and writes a shell script in its place. The hook's environment is cleared to `HOME` alone, so the
  script's behaviour and log path are written into its text:
  - AC1, a quiet disk: the script reads its stdin and exits 0, saying nothing, as a hook says nothing when its spooled
    line synced in time. No call is late, so the run has 0 of the five late calls it needs.
  - AC2, a slow hook while its line is still syncing: the script reads its stdin, sleeps 200 ms, then prints
    deep-hook's own words, `deep-hook: spooled s-2179, but its sync didn't finish within the hook's 50 ms`, to stderr.
    Every call is late and takes over 200 ms, so the first five calls give the test its five late calls.

The test checks that the stand-in was still in place after the run and that busy_disk ran it; either missing fails as
`BLOCKED: …`.

Why not the real hook on a quiet disk: on this machine, at a load of about 78, the real hook with the writing-nothing
`dd` had five real syncs outlast the deadline within 18 calls, and busy_disk passed (`BASE-FAILURE.txt`). The real
disk's quiet can't be made on purpose, so the hook's own report is.

## The surface, and the seam assumed

`affected.mjs`'s reading of a cargo job is reached through its public entries, `scripts/affected.mjs` (`cargoResults`,
`crates`, `classify`) and `scripts/lanes.mjs` (`readSkips`, `timed`), the functions its `main` calls on the job's log:
`cargoResults(output, status, crates(root))`, then `readSkips` against `scripts/known-failures.json`'s `skips`, then
`classify` at load 0, so no timing budget reads unmeasured. Running the whole `node scripts/affected.mjs` for a path
under `crates/deep-hook` would select hundreds of other suites, lints and builds, so that reading is the one taken. Each
test prints the lines `affected.mjs` would print for it (`INCONCLUSIVE <id>: <reason>`, `NEW FAIL <id>`, `KNOWN`,
`LISTED`, `PASS`) as diagnostics.

The assumed seams, all already at the base: busy_disk finds `dd` through its own PATH, spawns the deep-hook binary at
its `CARGO_BIN_EXE_deep-hook` path, reads a late call from the hook's stderr line above, and is a test named
`a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms` in the `busy_disk` test target. A fix that renames
the test, moves the target or reads lateness another way needs a redraft. A fix that reads INCONCLUSIVE by any route those readers take (a cargo
line `affected.mjs` reads as a skip, a BLOCKED or INCONCLUSIVE note, or `test result: INCONCLUSIVE`) passes AC1. A fix
whose route works only in `affected.mjs`'s `main` and not in those readers would fail it; that is a dispute for the
redraft.

The test ID is matched by `busy_disk` in it, so the reading may name the test or its target.

## Wrong programs each test fails on

- AC1: the base commit. Its run of 60 quiet calls fails at `busy_disk.rs:64` with "only 0 spooled lines' syncs
  outlasted the deadline in 60 calls, so this proves nothing: the disk wasn't busy enough", which `affected.mjs` reads as
  `NEW FAIL cargo -p deep-hook --test busy_disk › a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms`
  (`BASE-FAILURE.txt`). A program that passes a quiet run also fails AC1 (it proved nothing), and so does one that lists
  it as a known failure or a listed skip.
- AC2 passes at the base, which is right: the base fails a slow hook. It is kept as the criterion's proof and as
  regression protection for the fix. It fails on a program that reads every busy_disk run INCONCLUSIVE (it finds the
  INCONCLUSIVE line), on one that drops or weakens the median check (busy_disk passes), and on one that counts late calls
  wrongly so the slow run stops short of five (busy_disk reads INCONCLUSIVE). None of these was run: each would be an
  edit to `busy_disk.rs` or `lanes.mjs`, outside this folder.

## Not covered here

The issue's Scope also asks that the test or `scripts/lanes.mjs` say what busy_disk writes (up to 60 files of 512 MB in
turn under `/tmp`). That is not an acceptance criterion and is a matter for the diff's review. The issue's Proof asks
for the test's output on a quiet disk and under its own load, before and after; the load run needs a real disk and is
the implementing job's to save.

This file builds with cargo and runs for about a minute; `scripts/lanes.mjs` doesn't list it at the base, and whether
it belongs in its alone or slow list is the implementing job's call.

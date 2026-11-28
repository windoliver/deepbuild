# Acceptance tests for #3588: the rebuild before a timed job waits at most the time left to the hour

A blind job wrote these tests before any work on #3588 existed, from these inputs only:

- issue #3588: its Why, its Scope, its four acceptance criteria, its Not in scope and its list of older tests;
- the design sections it links: `docs/parallel-proof.md`, section 7a's "The hour" (#3567), section 7b (#3296),
  section 6 (the grant-wait table, Inherited grants, Tables of a test's own) and section 5's "Binaries for tests";
  `docs/technical-design.md`'s Dogfooding and Repo guards; `AGENTS.md`;
- the base commit `914bd5f29`. There I read `scripts/affected.mjs` (its timed phase, `ready`, `prepare`, `run`),
  `scripts/proof-binaries.mjs` (`buildBinaries`, `binaryPlan`), `scripts/throttle.mjs`, `scripts/proof-change.mjs` (the
  criterion tags), `scripts/wait-ratchet.mjs`, `scripts/twins-lint.mjs`, `scripts/repo-rules.mjs`, and the blind suites
  `3567`, `3296`, `2820`, `1115`, `2574`, `3333` and `3334` for their helpers and conventions.

No test imports the code under test. The helpers reuse the older blind suites' helpers by import and never edit them:
#3567's sandbox, run (`start`), holders (`hold`) and table readers; #2820's Cargo workspace and fixture repository;
#1115's timed path; #3296's machine preload. Per AGENTS.md the implementing agent doesn't edit these files; a dispute
goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3588/*.test.mjs'
```

They must run under `node --test`: only inside a test run does a request keep a table of its own (section 6). They are
offline, on real processes and the real toolchain: this checkout's `scripts/affected.mjs`, `scripts/throttle.mjs` and
`scripts/lease`, real `node --test` jobs and a real `cargo build` of a one-crate workspace, in a scratch git
repository. Stubbed, at boundaries #3588 doesn't own: the lint lane's own scripts (by #1115's tree) and the machine's
load, which reads 0 in every node process of the scene (#3296's `machine.mjs`, by `NODE_OPTIONS`), since a top-level
timed request waits for a load below the cores and the machines this runs on are busy.

On the Linux machine at a 1-minute load of 207 to 227 on 20 cores, the two files side by side took 185 s on a
throwaway guess that holds the criteria, and 265 s on the base, where criterion 1's run goes on to its 260 s limit.
Each run has its own limit (4 minutes and 20 s), past which its process group is stopped and the test fails with the
output so far; each test has its own timeout too.

**No test reads or writes the machine's table at `~/.deepbuild/throttle/`.** Every process a test starts gets #3567's
sandbox: a temporary `HOME`, a `DEEP_THROTTLE_TABLE` folder and a `TMPDIR` of the test's own, with `DEEP_THROTTLE`,
`DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_TEST_GRANT_WAIT`, `DEEP_SHARDS`, `DEEP_AFFECTED_MIN`, `DEEP_BIN_DIR`,
`NODE_OPTIONS`, the jobserver variables and others unset unless the test sets one, and cargo as #2820's sandbox gives
it (no `CARGO_TARGET_DIR` or wrapper, a `CARGO_HOME` of the sandbox's). Each run and each holder starts in a process
group of its own, stopped after its test by that group's PID; nothing is stopped by name or port, and the sandbox is
removed.

## The scene (`helpers.mjs`)

- **The fixture repository** (#2820's `fixture`): a copy of this checkout's `scripts/`, the lint lane's own scripts
  stubbed, with a Cargo workspace of one crate whose one binary, `tool3588`, prints `tool3588 runs`, built there by
  `cargo build --locked --offline` before the run, so the run's own build is quick (6 s on the base).
- **The untimed file**, `tests/fixture-3588/cleanup.test.mjs`, in the parallel block. Its one test waits until the test
  says every build slot is held (a go file), reads `tool3588` through `DEEP_BIN_DIR`, deletes it there, as a machine's
  cleanup would, and in criterion 1 fails one assertion on purpose.
- **The timed file**, at the first `.test.mjs` path of the real `timed` list that isn't left to a person (#1115's
  `timedPath`, today `tests/acceptance/1113/load.test.mjs`), so the tree's own `lanes.mjs` runs it in the timed phase.
  Its one test notes that it ran and runs `tool3588` through `DEEP_BIN_DIR`.
- **The run**: `node scripts/affected.mjs --timed <untimed> <timed>`, with `DEEP_AFFECTED_MIN=3`, started by #3567's
  `start`; its start is the moment its process exists, its end its exit.
- **The holders** (#3567's `hold`): `node scripts/throttle.mjs build --wait 30 -- node hold.mjs`, one per build slot
  of the table (two on Linux, one on macOS), each another session's top-level build grant, held until the test lets go
  or ends.
- **The order**, by events, never by time: once the table's log shows the run's own build grant released, the holders
  start; once each has noted that its grant came, the go file is written; once the untimed file has noted the binary
  deleted, its `DEEP_BIN_DIR` is watched (`fs.watch`) for the binary to come back. So every build slot is taken after
  the run gave its build grant back and before its timed phase.

## The surfaces assumed where the issue leaves room

1. **"Every build slot ... taken for 10 minutes"**: the holders hold from before the timed phase until the test ends,
   which is after the run has ended or been stopped at its 260 s limit; no run is watched for 10 minutes, since the
   criterion's run must end within 4.
2. **"The run exits within 4 minutes of its start"**: from the run's process start to its exit, at most 240 s, on the
   test's clock. A run still going at 260 s is stopped by its process group and the test fails there; that is how "the
   merge base is still waiting at 4 minutes" reads.
3. **"Its output reads the untimed file FAIL"**: a line starting `FAIL` or `NEW FAIL` names the untimed file's failed
   test, and the summary reads `FAIL affected: `. **"The timed file INCONCLUSIVE with `not started: the run reached its
   bound of 3 min`"**: a line starting `INCONCLUSIVE` holds the timed file's path and that text, and no line starting
   with another state names it.
4. **"The timed file's test never ran"**: the note its test writes as it starts is absent.
5. **"The binary is still absent from `DEEP_BIN_DIR`"**: the run removes its binaries' folder as it exits, so "still
   absent" is read while it lives: from the cleanup to the run's exit, no create or rename of `tool3588` is seen in
   that folder (`fs.watch`), and it isn't there when the watch starts.
6. **"The holders letting go 20 s after the run's timed phase began waiting"**: the timed phase began waiting at the
   first look that finds, in the table's `table.json`, a request for a `build` or a `timed` grant from a process that
   isn't a holder's throttle: the rebuild's build request, or, for a program that rebuilds nothing, its timed job's
   timed request. 20 s later (a fixed wait, the scene's own schedule, marked `// deadline:`) each holder's throttle is
   sent SIGTERM, which it passes to its command, and it gives its grant back.
7. **"The rebuild is granted"**: after the first holder's `released` line in the table's log, a `granted` line of class
   `build` from a process that isn't a holder's. It doesn't say which process of the run asks, or whether its grant is
   top-level, since the issue leaves the grant's holder to the change.
8. **"The timed file runs and reads PASS"**: its test's note shows `tool3588` found in `DEEP_BIN_DIR` and printing
   `tool3588 runs`; no line starting with a state names either file; the summary reads `PASS affected: ` with 2
   passed. `affected.mjs` prints no per-file line for a pass, so the summary is where a PASS reads; `--results` is not
   used, since the issue names the surface without it.

## Criteria to tests

The tag is `#3588.<first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` works it out.

| Criterion | Tag | Test (file) | Wrong program, and the test's message on it |
|---|---|---|---|
| 1: every build slot held, the untimed file failing: exit 1 within 4 min, untimed `FAIL`, timed `INCONCLUSIVE` not started, its test never ran, the binary not built again | `#3588.7a8aaa71` | `bound.test.mjs` | **The merge base**: its rebuild waits 30 minutes. "affected.mjs was still running 260 s after its start, past the 4 minutes it must exit within at a bound of 3 min: its rebuild before the timed job was still waiting for a build grant behind the holders" |
| 2: the same, the untimed file passing, the holders letting go 20 s after the wait began: the rebuild granted, the timed file `PASS`, exit 0; holds on the merge base | `#3588.704a8c75` | `granted.test.mjs` | **The twin `skips-the-rebuild`** (`twins/README.md`): the timed phase builds nothing again. "no build grant was granted to the run once the holders let go: nothing was built again of what the cleanup removed" |
| 3: `tests/acceptance/3296/` and `tests/acceptance/3567/` pass unchanged | `#3588.56831124` | no new test | Proven by running those two suites unchanged on the change; this suite adds nothing for it |
| 4: section 7a's "The hour" says the rebuild waits at most the time left and builds nothing at the bound | `#3588.1ab9c87c` | no test | By diff review of `docs/parallel-proof.md`, as the criterion says |

Seen failing too, to show criterion 1's last checks see what they say: the throwaway guess with one fault, which at the
bound, with no grant, puts the binary back into `DEEP_BIN_DIR`, fails `bound.test.mjs` with "tool3588 was put back
into DEEP_BIN_DIR after the cleanup, though no build grant came before the bound".

## On the base

`BASE-FAILURE.txt` holds `node --test 'tests/acceptance/3588/*.test.mjs'` at `914bd5f29` on the Linux machine.
Criterion 1's test fails at its assertion for the expected reason: its run was still going 260 s after its start,
its rebuild's build request waiting in the table behind the two holders' grants. Criterion 2's test passes, as it
must (regression protection): the base's 30-minute wait outlasts the holders' 20 s.

To tell a test's fault from a program's I wrote a throwaway guess at the change in a scratch copy of the checkout
outside it: in the timed jobs' loop, a missing binary is built again under one build grant of the run's own, waited
for at most the lesser of 30 minutes and the time left, under which `buildBinaries` passes through; with no grant at
the bound the run sets its bound and builds nothing. Both tests passed on it (185 s side by side). The twin, laid on
the base, failed `granted.test.mjs` at its assertion. The guess and the copies are deleted; they prove nothing about
the real change. `BASE-FAILURE.txt` ends with those runs' result lines.

## What the tests can't see, and what I left out

- **The third Scope line**: a rebuild whose wait runs out before the bound reads `INCONCLUSIVE no grant: no build
  grant came within <min> min to build again what a cleanup removed`. No criterion names it and no test runs it: with
  the bound at 3 minutes the wait is always the time left, so it ends at the bound, and a 30-minute wait is too long
  for a test.
- **The 30 minutes**: that the wait is at most 30 minutes when the time left is longer isn't run.
- **The alone block's rebuild and the untimed jobs' rebuild** (Not in scope, #3221) aren't run: the untimed file is in
  the parallel block, which checks no binary.
- **An in-place build** (a `cargo build` a timed test starts itself, rebuilt by `buildInPlace`): the timed file reads
  only `DEEP_BIN_DIR`, as the criteria say.
- **macOS**: drafted and run on Linux (two build slots); the holders count the slots by platform, as #2820's
  `BUILD_SLOTS` does, but nothing ran on the Mac.
- **The twin's lines**: `twins/skips-the-rebuild/lines.json` finds the base's line `        ready(root);` in the timed
  jobs' loop. If the change rewrites that line the twin is stale, and a blind redraft of this suite writes it again.
- **Fixed waits**, each marked `// deadline:`: the criterion's 20 s before the holders let go, the 4-minute limit, and
  the limits that turn a hang into a failure.

## Files

- `helpers.mjs`: the sandbox with cargo, the scene's files, the run and its holders in the criteria's order, the
  table's waiting requests, letting go, and a failure's dump.
- `bound.test.mjs` (criterion 1), `granted.test.mjs` (criterion 2).
- `twins.json`, `twins/skips-the-rebuild/lines.json`, `twins/README.md`: criterion 2's planted wrong program.
- `BASE-FAILURE.txt`: the runs on the base, the twin and the guess, paths redacted.

No fixture holds a secret or personal data.

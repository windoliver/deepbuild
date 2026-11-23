# Acceptance tests for #3170: the Spark gets a reflink folder, so deep-hook's copy-on-write test runs there

I drafted these tests blind from these sources:

- issue #3170, as its body reads at the base
- AGENTS.md, `docs/technical-design.md` (Dogfooding and the proof sections), `docs/parallel-proof.md` (sections 3, 4, 8, 10, 11)
- the base commit `61aa8eb06`

At the base I also read `crates/deep-hook/tests/cli.rs` (the test the issue names, and its helpers),
`crates/deep-hook/src/main.rs` (`clone_one`), `scripts/lanes.mjs` (`checks`, `runLanes`, `cargoResults`),
`scripts/proof-change.mjs` (`criterionId`), the repository's `.cargo/config.toml`, and `tests/acceptance/1121/` for its
shape. The helpers are written here, never imported from another suite. I read no other branch, PR or session's notes.
Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

## Running them

```sh
# Any machine. On the Mac all three skip, INCONCLUSIVE (platform). One file at a time: two of them build and run
# deep-hook, and a build beside a running cli test rewrites the binary it spawns.
node --test --test-concurrency=1 'tests/acceptance/3170/*.test.mjs'
```

They prove their criteria only on the Spark (Linux aarch64), and the third on any Linux. `cargo`, `cp` (GNU), `stat`,
`git` and `node` 24 must be on `PATH`. Run them from a plain shell: each test takes `DEEP_TEST_COW_DIR` out of the
environment it was given (The surface, below). A cold build of deep-hook's cli target takes a few minutes; set
`CARGO_BUILD_JOBS` to bound cargo on a shared machine. They're `*.test.mjs` under `tests/acceptance/`, so the unit lane
doesn't pick them up.

**A test that can't prove its criterion on the machine it runs on skips**, with a note that starts `INCONCLUSIVE
(platform):` and names the machine. A skip is unrun, never a pass (AGENTS.md, invariant 2).

All run on real components: the real `runLanes` of `scripts/lanes.mjs` under its real throttle and lease, the real
cargo and deep-hook's real cli target, GNU `cp --reflink=always` on the machine's own file systems. Each test points
`HOME` at a temporary folder, so `~/.deepbuild` is the sandbox's, never the real one; `CARGO_HOME` and `RUSTUP_HOME`
stay the machine's. Each process a test starts gets its own process group; nothing is killed by name or port.

## Criteria to tests

Each ID is `#3170.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space collapsed>`, as
`criterionId` in `scripts/proof-change.mjs` works it out. Each test carries its tag at the start of its name.

| Criterion | Test (file) | Runs on | What it requires |
|---|---|---|---|
| AC1 `#3170.f6002c7f` The Spark has a reflink folder, and a lane's `cargo test` there runs with `DEEP_TEST_COW_DIR` naming it | `lane-folder.test.mjs` | The Spark | The unit lane's own `cargo test --workspace …` command, run by the real `runLanes` on a one-crate workspace, runs its test with `DEEP_TEST_COW_DIR` set, to an absolute path of a folder, in which `cp --reflink=always` of a file succeeds |
| AC2 `#3170.4db366cf` With it, `cargo test -p deep-hook --test cli --locked` on the Spark passes, the copy-on-write half included | `cli-target.test.mjs` | The Spark | That command, run by the real `runLanes` as the unit lane's, prints `test a_folder_is_cloned_copy_on_write_… ... ok`, no other test line but `ok` or `ignored`, no line starting `BLOCKED: `, and `test result: ok. N passed; 0 failed` |
| AC3 `#3170.618b6b1f` On a Linux machine without such a folder the test still reads BLOCKED and names the fix | `blocked.test.mjs` | Any Linux | With `DEEP_TEST_COW_DIR` naming a fresh folder where `cp --reflink=always` fails (under `/var/tmp`, else the temporary folder, else `/dev/shm`), `cargo test -p deep-hook --test cli --locked -- --exact <that test>` exits non-zero, the test line reads `... FAILED`, and its panic is a line starting `BLOCKED: <that folder> ` that names `DEEP_TEST_COW_DIR` and btrfs or XFS |

## The surface (my choice where the issue leaves it open)

- **"A lane's `cargo test`"** is the command of `checks` in `scripts/lanes.mjs` that starts `cargo test` and holds
  `--workspace` (the `unit` lane's at the base), run through the real `runLanes` with that lane's other properties but
  `paths`. AC2 runs the issue's command through the same lane object in its place, so whatever the lane or the machine
  gives a lane's cargo test, the cli target gets.
- **The variable is supplied by the lane or the machine, never by whoever starts the run.** The tests take
  `DEEP_TEST_COW_DIR` out of the environment they inherit. Where the machine's cargo reads it (its cargo home's
  `config.toml` `[env]`, as section 4 keeps sccache's setting there) or where `lanes.mjs` sets it both meet this; a
  value only in an interactive shell's profile doesn't. The fixture workspace sits in the temporary folder, so a
  `.cargo/config.toml` in the repository is not read for AC1 (and a Spark path there would break AC3 on other Linux).
- **The folder is named whole**: the variable's value is the folder itself, as `cli.rs` reads it, not a parent or a list.
- **AC3's machine without a folder** is this Linux machine with the variable, in the test's own environment, naming a
  folder without reflink. That value wins over a machine's cargo config `[env]` entry unless the entry has
  `force = true`; such an entry would make AC3 untestable on the Spark and needs a redraft.
- **"Reads BLOCKED and names the fix, as today"** is read as today's panic: a line starting `BLOCKED: <folder> ` that
  names `DEEP_TEST_COW_DIR` and a file system with reflink (btrfs or XFS). The wording past that may change.

## On the base

| Test | The Mac | The Spark |
|---|---|---|
| AC1 `lane-folder.test.mjs` | Skips | FAILS: the lane's cargo test runs with no `DEEP_TEST_COW_DIR` |
| AC2 `cli-target.test.mjs` | Skips | FAILS: the copy-on-write test is FAILED, `BLOCKED: /var/tmp can't make a reflink copy; …` (29 others pass) |
| AC3 `blocked.test.mjs` | Skips | Passes, as the criterion says it does today |

Each criterion's planted wrong program is in `twins/` (`twins/README.md`), named by `twins.json`. `BASE-FAILURE.txt`
holds every run on both machines, each twin's run on the Spark, and a stand-in run that shows a cargo home's `[env]`
reaching the lane's cargo test.

## Open questions for the implementer

- **Where the setting lives.** The issue says only that a lane's cargo test runs with the variable. These tests accept
  the machine's cargo config or `lanes.mjs`, and refuse a value only the caller's shell holds.
- **A lane run by `scripts/lane-remote.mjs`** from the Mac: the tests run `runLanes` on the Spark itself. If the real
  route sets the variable only in the remote run's own environment, AC1 needs a redraft.
- **The folder's file system.** Making a btrfs or XFS folder on the Spark needs root, which this job didn't use. The tests
  ask only that `cp --reflink=always` succeed in it; `stat -f` names its type in a failure.

## What these tests can't see

- **The whole workspace's `cargo test` on the Spark** with the folder: AC1 runs the lane's command on a one-crate
  workspace, and AC2 the cli target alone.
- **The folder's persistence across reboots**, and its room: a run after a restart shows the first.
- **A Linux machine other than the Spark**: AC3 was run only on the Spark, with a folder it chose there.
- **The twins of AC1 and AC2 failing for their own faults**: the base already fails both, so those twins can't be told
  from the base until the Spark has its folder.

## Files

- `helpers.mjs`: the machine, the sandbox, running a process, the reflink probe, the probe workspace, the driver that
  reaches `lanes.mjs`.
- `lane-folder.test.mjs` (AC1), `cli-target.test.mjs` (AC2), `blocked.test.mjs` (AC3).
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the runs on the base on both machines, each twin's run and the stand-in run.

Outside this folder, for the implementing job: the twins are whole copies of large base files, so the lint lane's
ratchets name them until `scripts/wait-ceilings.json` lists
`tests/acceptance/3170/twins/blocked-reads-pass/crates/deep-hook/tests/cli.rs` at 8 and
`tests/acceptance/3170/twins/clone-drops-mode/crates/deep-hook/src/main.rs` at 4, and `scripts/size-ceilings.json`
lists that `main.rs` at 2064 and `tests/acceptance/3170/twins/lane-names-var-tmp/scripts/lanes.mjs` at 2385, as other
suites' twins are listed. (Both ratchets fail on the base for other files too.)

No fixture holds a secret or personal data.

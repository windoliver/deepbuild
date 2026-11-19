# Acceptance tests for #1831: three readers of the reference Macs, and #13's spine row

Written first, blind, by a job that never saw a fix. On November 17, 2026 it read:

- issue #1831 (its text as of that day), and PR #1675's merge commit through
  `gh pr view 1675 --repo windoliver/deepbuild --json mergeCommit`: `96ee0fc4d7b8882145961ca215ad50c3e3d4a1ee`
- `AGENTS.md` (Proof) and `docs/technical-design.md` ("The reference Macs"; Wrong programs, The edit guard,
  Dogfooding, "Tests written first")
- the base commit `212f16d09`, for call shapes: `scripts/benchmark.mjs` (`references`, `fingerprint()`),
  `scripts/agent-harness.mjs` (`machine()` and the budgets lane's line), `benchmarks/canvas.mjs` (the `costs`
  workload and `--write`), `crates/deep-show/src/hub.rs` (`machine_factor`), `scripts/spine.mjs` (`list`)
- for conventions only: `tests/acceptance/607/` (the harness on a faked Mac), `tests/acceptance/48/helpers.mjs`
  (the fake agent), `tests/acceptance/379/` (deep-show's `machine` and its planted check), `tests/acceptance/568/`,
  `tests/acceptance/1116/` (twins), `tests/acceptance/2731/` and `tests/acceptance/2742/`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## What the base does

`scripts/benchmark.mjs` lists three reference Macs: Mac15,7, Mac15,12 and Mac17,10. Three readers each keep a list
of the first two, so on a Mac17,10:

| Reader | At the base |
| --- | --- |
| `scripts/agent-harness.mjs` | the budgets lane's line says `machine.reference: false`, "model Mac17,10, not Mac15,7 or Mac15,12" |
| `benchmarks/canvas.mjs` | `costs --write` measures, then throws "coefficients come from a reference Mac; this is Mac17,10" |
| `crates/deep-show/src/hub.rs` | the planted check `estimates_on_this_machine` scales the coefficients by 1.6 |

`node scripts/spine.mjs list` prints `#13 7222b1696e35128335f7ef7218a5bd23add6787b`.

## Criteria and tests

| Criterion | Tag | Tests |
| --- | --- | --- |
| "With a planted Mac17,10 fingerprint, the agent harness counts its run as on a reference Mac, `benchmarks/canvas.mjs` writes its costs, and deep-show scales by 1.0; with a planted Mac14,2 fingerprint each treats it as off the list. A planted copy of any of the three with its own two-Mac list fails, naming the file" | `#1831.13f43b1f` | one test per reader, each under both fingerprints: `harness.test.mjs`, `canvas.test.mjs`, `deep-show.test.mjs` |
| "`node scripts/spine.mjs list` shows #13 at PR #1675's merge commit" | `#1831.2e170a8b` | `spine.test.mjs` |

Each test's name starts `AC<n> #1831.<h8>`.

### The surface under test, and how a fingerprint is planted

| Reader | Surface | The planted fingerprint | Mac17,10 (must hold) | Mac14,2 (off the list) |
| --- | --- | --- | --- | --- |
| the agent harness | `node scripts/agent-harness.mjs budgets --base … --changed scripts/agent-harness.mjs --claude <fake> --codex <fake>`, the `machine` of its one `"lane":"harness budgets"` line | a fake `sysctl`, `pmset` and `osascript` first on `PATH` | `machine.model` is `Mac17,10` and `machine.reference` is `true` | `machine.reference` is `false` with a `why` |
| the canvas cost writer | `node benchmarks/canvas.mjs costs --write`, its exit status and `crates/deep-canvas/costs.json` beside it | the same fakes first on `PATH` | exits 0; the costs file's `fingerprint` is `Mac17,10`, `Apple M5 Max`, 64 GiB, with terms | exits non-zero, stderr names `Mac14,2` or a "reference Mac", and the costs file is byte for byte as it was |
| deep-show | `deep-show run`, one scenario with `planted: "estimates_on_this_machine"` and one `deep_show` call of a board over its class (#379's) | the scenario's `machine: {model, chip, memoryBytes}`, which #379 added to stand in for the hub's machine | the `over_budget` issue is deep-equal to the one under a Mac15,7: a factor of 1.0 | the issue's `actual` differs from the Mac15,7's |

The fakes (`helpers.mjs`, `fakeMachine`) answer `sysctl -n hw.model`, `hw.memsize`, `machdep.cpu.brand_string` and
the CPU counts; `pmset -g ps` (AC Power), `-g` (`lowpowermode 0`) and `-g therm` (no warning); and `osascript`'s
Low Power Mode (`false`) and thermal state (`0`). Any other question fails, so nothing of the Mac the tests run on
leaks in. The planted Macs:

| | model | chip | memory | cores |
| --- | --- | --- | --- | --- |
| the design's third reference Mac | `Mac17,10` | `Apple M5 Max` | 64 GiB | 18 |
| never a reference Mac | `Mac14,2` | `Apple M2` | 16 GiB | 8 |
| a reference Mac at the base too (deep-show's comparison) | `Mac15,7` | `Apple M3 Pro` | 36 GiB | 12 |

deep-show takes its fingerprint from the scenario and not from `PATH`: a right deep-show may read its own machine
without starting `sysctl`, and the scenario's `machine` is the surface #379 named for this. "Scales by 1.0" is read
where deep-show scales at all, which is its planted check; the test compares with a Mac15,7, a reference Mac
before and after, so it names no number but 1.0.

**The harness lane's status isn't asserted.** At the base, #48's fake Codex writes in the read-only job, because
the launch facts have since turned Codex's own sandbox off, so the lane reads `BLOCKED` on every machine before it
judges the machine ("runs that didn't pass measured nothing"); #607's tests fail at the base for that reason, and
`coveredVersion` in `tests/acceptance/48/helpers.mjs` now picks a `1.0.0` from another file (this suite passes the
fake a version from `adapters/*.facts.json`). Both are findings outside this issue. The lane's `machine.reference`
is what the lane's own status follows, and it is the harness's word on whether "its run counts as on a reference
Mac".

**canvas.mjs is run for real**, and it writes beside its own file. So the test runs a copy of `benchmarks/canvas.mjs`
from a scratch folder whose other entries are links into this checkout, with its own copy of
`crates/deep-canvas/costs.json`; the checkout's `target/` is linked, and a `cargo` on the scratch `PATH` runs the
real cargo in the checkout, so `cargo build --locked --release -p deep-show` builds the checkout once instead of a
second workspace under another path. The checked-in costs file is compared before and after, and the test fails if
it changed. The run needs the release deep-show (canvas.mjs builds it), the debug deep-gpu (the test builds it) and,
on macOS, a GPU that `deep-gpu`'s live view can use. A shared list that canvas.mjs reads by a path under its own
root is reached through the links.

### The wrong programs: "a planted copy of any of the three with its own two-Mac list fails, naming the file"

This is the criterion's wrong case. The planted copies are the three readers as the merge base has them, each
with its own list of Mac15,7 and Mac15,12:

| Planted copy | Blob at `212f16d09` | Fails | Naming |
| --- | --- | --- | --- |
| `scripts/agent-harness.mjs` | `a7b76853` | `harness.test.mjs` | "scripts/agent-harness.mjs keeps a reference list without the Mac17,10: …" |
| `benchmarks/canvas.mjs` | `c3443829` | `canvas.test.mjs` | "benchmarks/canvas.mjs keeps a reference list without the Mac17,10: …" |
| `crates/deep-show/src/hub.rs` | `491c549b` | `deep-show.test.mjs` | "crates/deep-show/src/hub.rs keeps a reference list without the Mac17,10: …" |

Each reader has its own test in its own file and process, and each test's Mac17,10 assertion starts with the
reader's path, so a tree with one of the three put back fails that reader's test alone, naming it. The preflight's
before lane plants all three at once by running the tests on the merge base (design, Wrong programs: "For a fix,
the merge base is that program"), and `BASE-FAILURE.txt` is that run made by hand. So this suite has no
`twins.json` and no copies under `twins/`: the lane reads twins only for a test the merge base doesn't fail, and a
checked-in copy of `hub.rs` (2,689 lines) would stop compiling against the crate around it within days, which
leaves a wrong program that doesn't run. To plant one copy by hand on a fixed tree:

```sh
/usr/bin/git show 212f16d09:scripts/agent-harness.mjs > scripts/agent-harness.mjs   # or benchmarks/canvas.mjs, or crates/deep-show/src/hub.rs
node --test tests/acceptance/1831/harness.test.mjs                                  # fails, naming scripts/agent-harness.mjs
/usr/bin/git checkout scripts/agent-harness.mjs
```

The tests never read a reader's source: a copy that keeps a private list which happens to name all three Macs
passes them. Whether a reader reads the one list is the review's to see; the issue's criteria name behavior only.

### Guards that already hold at the base

Inside each AC1 test, before the Mac17,10 assertion that fails at the base: the Mac14,2 is off the list for the
harness (`reference: false` and a `why`), for canvas.mjs (non-zero exit, costs untouched) and for deep-show (its
estimate differs from the Mac15,7's). They fail on a fix that lets every Mac count.

## How to run

```sh
export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node | grep '^v24' | tail -1)/bin:$PATH"   # Node 24
node --test tests/acceptance/1831/spine.test.mjs       # no build, a few seconds
node --test tests/acceptance/1831/harness.test.mjs     # no build, under a minute; macOS only
node --test tests/acceptance/1831/deep-show.test.mjs   # builds target/debug/deep-show first
node --test tests/acceptance/1831/canvas.test.mjs      # builds target/debug/deep-gpu, then canvas.mjs builds the release deep-show; two cost runs on the GPU
```

`BASE-FAILURE.txt` is the run at the base, on a Mac15,12 under other sessions' load: all four tests fail, each at
its Mac17,10 or #13 assertion. From nothing, the three builds took 68 minutes there; once built, the two cost runs
of `canvas.test.mjs` took about a minute and the other three files under a minute together.

No `npm ci` is needed: the tests and the scripts they start import only Node's own modules. The builds are the
sibling suites' (`cargo build --locked --bin <name>` with the pinned 1.99.1 toolchain first on `PATH`,
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`). A build that fails, and the harness test off macOS, fail with a
message that starts `BLOCKED:`; nothing is skipped.

Temp folders (`deep-1831-harness-*`, `deep-1831-show-*`, `deep-1831-canvas-*` and #48's `deep-harness-48-fake-*`
under the system temp folder) are removed when their test ends. canvas.mjs makes and removes its own
`deep-canvas-bench-*`. Nothing is stopped by name or port; #48's helper stops what the fake agent started, by PID.
No network.

## What the implementer adds outside this folder

No new surface: every test goes through one the base already has. Two notes:

- `scripts/lanes.mjs`: `canvas.test.mjs` runs a micro-benchmark on the GPU and two cargo builds, and
  `harness.test.mjs` starts the harness's sessions. If the lanes run them beside other suites they may need this
  folder in `alone`, and `canvas.test.mjs` and `deep-show.test.mjs` in `slow` where their builds take them past
  two minutes; this job didn't edit `lanes.mjs` and didn't run the lanes.
- deep-show keeps the scenario's `machine` field and the planted check `estimates_on_this_machine` (#379's
  surfaces), and the harness keeps `machine` on its budgets lane line (#48's and #607's).

## Left open

- **Where the one list lives** (in `scripts/benchmark.mjs`, or a file it reads too) and how deep-show, a Rust
  crate, takes it. No test names a file or an export.
- **Which parts of a fingerprint each reader holds a Mac to.** The planted Mac17,10 has the design's chip, memory
  and core count and is on mains power, so a reader that checks the model alone and one that checks all of them
  both pass. No test plants a Mac17,10 with the wrong memory or on battery.
- **The wording** of a refusal or a `why`, beyond canvas.mjs naming the model or a "reference Mac".
- **deep-show's factor off the list.** The base's is 1.6; the test asks only that a Mac14,2's estimate differ from
  a reference Mac's.
- **The other spine rows.** AC2 names #13 alone.

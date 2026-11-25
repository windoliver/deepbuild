# Acceptance tests for #3262: a canvas call plays once

Written first, blind, from issue #3262 as it reads on November 23, 2026 (its opening paragraphs and table, `Runs on:`,
Scope, three acceptance criteria and Proof line; it has no comments), the design sections it links and those they lean
on, and base commit `c8d9684f0` (`origin/main`, whose last merge is #3268, the spike #3222), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion, a file per run where a run needs a
file's whole time, and the two planted sides the criteria name.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-sessions-1.test.mjs`, `ac1-sessions-4.test.mjs`, `ac1-sessions-16.test.mjs` (the test's body is in `ac1.mjs`) | `#3262.55d4e80f` | #3222's harness with 1, 4 and 16 sessions in this checkout, judged; then the same run in the merge base's checkout, and both outputs kept side by side |
| `ac2-slow-call.test.mjs` | `#3262.e02db7d6` | the harness's `--sessions 15 --patches` run and the same with `--slow` in this checkout, judged; then both in the merge base's checkout, and the four outputs kept |
| `ac3-script.test.mjs` | `#3262.693f8038` | one canvas side sent #3222's 16-session script, each session ending after its last call; every reply against a fresh hub's |
| `ac3-suites.test.ts` (the scenarios are in `scenarios.ts`) | `#3262.693f8038` | a canvas side for each scenario of #806's, #393's, #384's, #1415's and #2694's suites, one of them with a session that ends; every reply against a fresh hub's |
| `judge.mjs` | | the judges: a harness output's medians, the slow call's pair, the fresh hub's scenarios and the first reply that differs |
| `harness.mjs` | | runs the harness in a checkout, finds the merge base's, keeps the outputs |
| `side.mjs`, `side.d.mts` | | drives `deep-show canvas` and `deep-show run`, compares |
| `script.mjs` | | #3222's 16-session script as its hub sends it to a side |
| `twins.json`, `twins/` | criteria 2 and 3 | the two planted sides (below) |
| `lane.json` | | the folder runs alone |
| `BASE-FAILURE.txt` | | each file run at the base (phase 2 of this job) |

## What was read

- The issue, and what the base holds of the issues it names: `docs/spikes/3222/` (README, `harness.mjs`, `probe.mjs`,
  `analyze.mjs`, `record.json`, `out/`) and `tests/acceptance/3222/`; `tests/acceptance/2694/`. #2686, #1721 and #241
  have no suite at the base and no criterion reads them.
- `docs/canvas-primitives.md`: Render-back ("a render from a pose or a view mints no revision and writes nothing").
  `docs/technical-design.md`: The canvas core; Numbers version 0 has to hold (Every task carries its own budgets, The
  reference Macs); How we know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong programs, The
  edit guard, Dogfooding); `docs/parallel-proof.md` sections 5 to 7. AGENTS.md.
- At the base, for surfaces and never for expected values: `crates/deep-show/src/canvas_side.rs` (`serve`, `READS`,
  `timed`, `line`, `read`, `answer`), the `canvas` branch of `main.rs`, `answer.rs` (`run`), `hub.rs` (`writer`),
  `shared/calls.rs` (`run_calls`); `packages/hub/src/canvas.ts` (`Canvas`, `shape`, `showCall`, `canvasCore`) and
  `hub-canvas.ts` (`canvasWorld`, `show`, `showCli`), `show.ts`; `scripts/proof-runs.mjs` (twins, `atAssertion`, a
  file's 20 minutes, `.mjs` files one at a time and `.ts` files in one run), `proof-change.mjs` (`criterionId`, the
  merge base), `benchmark.mjs` (`judgeLimit`), `lanes-lists.mjs`, `wait-ratchet.mjs`; the suites `806/` (`scenarios.ts`,
  `replay.ts`, `figure.ts`, `sessions.test.ts`), `393/`, `384/`, `1415/` (`helpers.ts`, `patches.test.ts`), `2694/`,
  `3222/` (`held.mjs`), and `2655/`, `2700/`, `2691/` for how a suite takes a merge base and keeps evidence.
- The spike's kept outputs were read to check this suite's judges and script against them in scratch probes (below);
  no test reads them and no number of theirs is in a test.

## How to run

```sh
npm ci --ignore-scripts                              # once, if node_modules is missing
npm run build --workspaces                           # the harness's hub is this checkout's build
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked --bin deep-show --bin deep-hook # the canvas core the hub runs, and the hook client it needs
export DEEP_3262_BASE=<a checkout of the merge base, built the same way>   # criteria 1 and 2

node --test tests/acceptance/3262/ac1-sessions-1.test.mjs
node --test tests/acceptance/3262/ac1-sessions-4.test.mjs
node --test tests/acceptance/3262/ac1-sessions-16.test.mjs
node --test tests/acceptance/3262/ac2-slow-call.test.mjs
node --test tests/acceptance/3262/ac3-script.test.mjs
node node_modules/vitest/vitest.mjs run tests/acceptance/3262/ac3-suites.test.ts --testTimeout=1200000
node node_modules/typescript/bin/tsc -p tests/acceptance/3262/tsconfig.json     # type-check
```

macOS, Node 24.22 first on `PATH`, `git`. One file at a time: each starts hubs or holds canvas sides, and four of them
read times.

| File | Needs | Takes |
|---|---|---|
| `ac1-sessions-<n>` | both checkouts built: `packages/*/dist`, `target/{debug,release}/deep-show` and `deep-hook` | the harness's run twice. At the base on a loaded Mac17,10 the spike's runs took about a minute for 1 and 4 sessions and several for 16. Not run by this job (BASE-FAILURE.txt) |
| `ac2-slow-call` | the same | four harness runs. At the base, where it fails after the first two, 27 s |
| `ac3-script` | `deep-show` (built by the file unless `DEEP_BIN_DIR` supplies it) | 240 calls on one side, then 93 fresh hubs, four at a time. 156 s at the base, at a load of 10 to 17 |
| `ac3-suites` | `deep-show`, the same way | 18 scenarios, 202 calls, a side and a few fresh hubs each. 15 s at the base |

The harness files build nothing: a hub finds `deep-show` only under its own checkout's `target/`. A harness run that
would pass the 18 minutes a file may take stops INCONCLUSIVE. Temporary folders are `/tmp/dh3262-*`, removed after;
every process is stopped by its PID (a harness, the hub its ready line names, a side, a fresh hub). Nothing uses the
network.

To run a file on a planted side by hand, once its `deep-show` is built (The planted sides, below):

- `ac3-script` and `ac3-suites`: give the folder that holds the planted binary as `DEEP_BIN_DIR`. A binary copied over
  `target/debug/deep-show` doesn't reach them: the file's own `cargo build` compiles nothing but puts the checkout's
  own build back in its place, and the run is the checkout's (BASE-FAILURE.txt, Readings).
- `ac2-slow-call`: the hub runs `deep-show` from its checkout's `target/`, and the file starts no cargo, so the
  planted binary is copied over `target/debug/deep-show` for the run and the checkout's own put back after.

## The surface under test

Nothing here is new to the program: no flag, field, call or environment variable is asked of it. The tests read what
the base already has, and these must stay as they are:

- **The harness**, `docs/spikes/3222/harness.mjs`, by its own command (`--sessions <n> [--patches] [--slow] [--gate]
  --home <dir> --out <file>`), and its output: `calls[]` with `session`, `kind`, `doc`, `startedMs`, `repliedMs`,
  `held`, `planted`, `outcome`; `load.start` and `load.end`; `machine.commit` and `machine.canvas_core`. The tests add
  `--gate` to every run: it makes the harness print `{"ready": true, "hub": <pid>}` before its sessions send a call,
  which is the only way a test learns the PID of the hub it must be able to stop. The go line is written at once.
- **`held`** (#2694's): how many calls the side holds after answering one. Each answer line of the side carries it,
  and the harness copies it into each row.
- **The side**, `deep-show canvas`: `{"world": {...}}` and `{"call": {...}}` lines in, one answer line each,
  `{"ok": true, "reply": {...}, "presented": …, "held": n}`, as `packages/hub/src/canvas.ts` sends and reads them.
- **A fresh hub**, `deep-show run`: one scenario line in (the world's fields, `clock`, `calls` each with its `at`), a
  new hub plays it once, `{"ok": true, "replies": [...]}` out.

Three names are this suite's own, and requirements on whoever runs or changes it:

| Name | What it is | Example |
|---|---|---|
| `DEEP_3262_BASE` | An environment variable naming a built checkout of the merge base, for criteria 1 and 2. It is a path to run, not a switch: it selects no planted program. The tests refuse it, BLOCKED, unless git reads it as being at `git merge-base HEAD origin/main` of this checkout with no change under `crates/`, `packages/`, `docs/spikes/3222/`, `Cargo.toml` and `Cargo.lock`, it is another folder than this checkout, and it is built | `DEEP_3262_BASE=~/dev/deepbuild-base node --test tests/acceptance/3262/ac2-slow-call.test.mjs` |
| `docs/evidence/3262/<run>.json` and `docs/evidence/3262/<run>.merge-base.json` | The kept outputs: the harness's output on the change and, beside it, on the merge base, each as the harness wrote it. `<run>` is `sessions-1`, `sessions-4`, `sessions-16`, `patches-15` or `patches-15-slow`, the spike's own names. The tests write them, and only from a run that passed | `docs/evidence/3262/sessions-16.json`, `docs/evidence/3262/sessions-16.merge-base.json` |
| `keeps-render-backs`, `keeps-hub-when-session-ends` | The two planted sides, twins under `twins/`, named in `twins.json` | `twins/keeps-render-backs/crates/deep-show/src/canvas_side.rs` |

### The times are readings

The issue's `Runs on:` line says of the times: "readings, before and after on one machine at one time, each with its
load". So criteria 1 and 2 are judged as a pair of runs, never as a budget on a quiet reference Mac:

- The change's run is judged first, as it reads: over 1.25 times fails, whatever the load, with both medians and the
  one-minute load at the run's start and end in the message. That is also what makes the merge base, run as the
  change, fail at the test's own assertion.
- The same command then runs in the merge base's checkout, right after, on the same machine. It is the before of
  this after, and the check that the reading can see the fault: the merge base grows (1.7, 3.2 and 100 times on main;
  434 ms against 88 ms). If the merge base's run reads within 1.25 times too, the harness didn't read on this
  machine at this time what the criterion is about, and the test is INCONCLUSIVE, never a pass.
- Without the merge base's checkout the test is BLOCKED, after the change was judged: nothing unrun passes.
- Both checkouts' hubs must run the same build of the core (`machine.canvas_core`), else BLOCKED: a debug run beside a
  release run is no before and after.

Not applied, and why: the design's rule that a time limit counts only on a reference Mac at a load under its cores
(`judgeLimit`), and its five runs. Those judge a budget against a limit in milliseconds. These criteria compare two
medians taken together, the issue calls the times readings and asks for each one's load rather than for a quiet
machine, and the spike's own readings were taken at loads of 21 to 400. A reading under load can still be wrong
either way: a load that rises during a run can push a right side over 1.25, and the 15 patches' medians are of small
times. Such a failure is a reading to dispute or take again on a quieter machine, not one this suite hides.

### Kept outputs

"The harness's output on the merge base is kept beside it" is done by the test, not taken from a file someone
committed: an agent's word is no evidence. The test runs the merge base's own harness (`<DEEP_3262_BASE>/docs/spikes/
3222/harness.mjs`, which starts that checkout's hub and core) itself, checks with git that the checkout is the merge
base and holds no changed program file, and that the output names that commit as the one it ran at
(`machine.commit`). It then writes both outputs to `docs/evidence/3262/` in the checkout under test, where the base
keeps a change's evidence. It writes nothing when the change fails, so a planted side's run never replaces them.

### Criterion 3: what a fresh hub is asked

`judge.mjs` `freshPlan` builds, from the lines a side was sent, the scenarios a fresh hub plays. The reply to a call
is that of a new hub, in the world as the side last had it, that plays every kept call before it, each at the time
it was first played, and then the call at its own.

- **A kept call** is every call but the six reads (`deep_kinds`, `cells`, `cell`, `updates`, `revisions`,
  `deep_query`) and, by this issue's Scope, a render-back (`render_back`). So no reply here comes from a hub that
  played an earlier read or render-back: if playing one again changed a later reply, the base, which plays every
  render-back again, would fail this test. It passes it (BASE-FAILURE.txt).
- **The clock** is the side's, as the base has it: 120 Hz, the latch 2 ms before vsync, half a millisecond a check,
  the n-th call at n × ten frames, a read and a render-back included (`CANVAS_CLOCK`, `CANVAS_SPACING`). `deep_query`,
  `geometry`, `fn` and `deep_kinds` take that time as `arrives`.
- **One scenario per world** holds that world's kept calls after every earlier one, so each is answered by a hub that
  has played exactly the kept calls before it; a call that isn't kept gets a scenario of its own.
- **Each side has its own evidence store, and the fresh hubs another**, so a fresh hub reads nothing the side stored.
- **The reply is compared whole** (`reply` of the answer line, deep equality). When no reply differs, the test
  changes one reply itself and checks the comparison reports that call, else BLOCKED.

### The 16-session script

`script.mjs` writes the script out from `docs/spikes/3222/harness.mjs` (a command, so it can't be imported): the
documents, sizes, values, rotation and seeded gaps, and the hub's world and call lines from `packages/hub/src`. A
scratch probe checked each session's calls against the spike's kept 16-session output: same session IDs, kinds and
documents, in the same order, 224 calls. A patch's `base` and a render-back's `rev` come from the session's last
reply, as in the harness. Two things are this suite's: the order across sessions (a call goes when its session's
seeded gaps say it would if no call took any time), and the sessions' ends (below).

### A session that ends

No scenario of the five suites and no run of the harness ends a session, and the criterion's planted side is wrong
only when one does. So each criterion 3 test ends sessions itself, as the hub would send it: the world again, without
the session whose `SessionEnd` reached it (`canvasWorld` leaves an ended session out), then a `revisions` read of a
document that session drew. In `ac3-script` every session ends once it has made its last call; in `ac3-suites` the
Codex session of #806's two figures ends after both are shown. At the base a call bound to a session the world
doesn't hold is refused `no_session`, so a fresh hub in the new world no longer has that session's revisions.

## The planted sides (twins)

| Criterion | Twin | The wrong program | Built at the base |
|---|---|---|---|
| `#3262.e02db7d6` | `keeps-render-backs` | A render-back is kept as a write is: `held` rises with it, and it is played again whenever kept calls are. At the base this is the side itself, so the twin's file is the base's `canvas_side.rs` with one comment added at the place | Yes: it is the base's own build |
| `#3262.693f8038` | `keeps-hub-when-session-ends` | The base's `canvas_side.rs` with one place changed, in `serve`: a world line that leaves out a session the side's world holds is taken as the world, but the hub that played the calls before it is kept and answers the reads that follow, where the base drops it | Yes: lay the file over `crates/deep-show/src/canvas_side.rs` and build `deep-show` |

Each fails its criterion's tests at their assertion, naming what the criterion says (BASE-FAILURE.txt has the runs):
`keeps-render-backs` fails `ac2-slow-call` naming the slow call's render-back (its session and document), as the base
does, being the same program; `keeps-hub-when-session-ends`, built at the base, fails both criterion 3 files naming
the first call whose reply differs, the `revisions` read after a session's end (call 153 of the script; call 3 of
#806's two figures).

Laid over the change, each whole file replaces the change's `canvas_side.rs` with the base's plus the plant. That is
still the wrong program its criterion names, and it builds while the change's other files call `serve` as the base
does. If the side moves or the twin no longer builds beside the change, make the same one-place change in the
change's own side and replace the twin's file with it, at the path the side then lives at; the tests stay as they
are:

- `keeps-render-backs`: a `render_back` call is kept exactly as a write is, and nothing else changes.
- `keeps-hub-when-session-ends`: when the world changes so that a session it held is gone, the side keeps its hub
  as it is and doesn't play its kept calls again; every other world change is handled as shipped.

A side that plays each call once and keeps render-backs is as fast as one that doesn't, until a world change makes
it play them again. So criterion 2's time alone can't fail that planted side, and the test also reads the side's own
count: `held` after the slow call must equal `held` after the call before it.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the issue body. Each test's name starts with
`AC<n> #3262.<id>`.

| Criterion | Test | What it asserts | What fails it |
|---|---|---|---|
| AC1 `#3262.55d4e80f` | `ac1-sessions-1`, `-4`, `-16` | In the harness's n-session run, the median service of the last 20 calls is at most 1.25 times the first 20's: medians by nearest rank over the calls in the order the core started them, as `analyze.mjs` took the issue's. Then the merge base's run is taken and both outputs kept | The merge base: 1.7, 3.2 and 100 times in the spike's outputs |
| AC2 `#3262.e02db7d6` | `ac2-slow-call` | The slow call, a render-back, isn't kept (`held` after it equals `held` after the call before it), and the 15 patches' median service behind it is at most 1.25 times the same 15 patches' median with none | The merge base, on both; `keeps-render-backs`, on the count |
| AC3 `#3262.693f8038` | `ac3-script` | On the 16-session script, with each session ending after its last call: every reply equals a fresh hub's | `keeps-hub-when-session-ends`. It passes at the base: behaviour that must not change |
| AC3 `#3262.693f8038` | `ac3-suites` | The same on 18 scenarios: #393's six and #384's six as #806's suite plays them, #806's two figures with a session's end, #1415's two, #2694's three | The same twin; passes at the base |

A failed criterion is node:assert's `AssertionError`, thrown from this folder. What can't be judged is a plain `Error`
starting `BLOCKED` (a checkout that isn't built, no merge base, an output that isn't the run the criterion names, a
side that refuses its world, a fresh hub with no reply) or `INCONCLUSIVE` (a run that didn't end in the file's time;
a merge base that reads no growth). Neither is a pass.

## Readings where the issue and the design leave a choice

- **"The first 20" and "the last 20"** are of every call of the run, setup calls included, in the order the core
  started them, as `analyze.mjs` `growth` reads them. A run of fewer than 40 calls is BLOCKED.
- **"Its 1, 4 and 16-session runs"** are `--sessions 1`, `4` and `16` with no other flag but `--gate`. The run must
  hold calls of exactly n sessions and no failed call (`outcome: "error"`), else BLOCKED.
- **"With the slow call in flight"** is read as: in the `--slow` run, each of the 15 patches started in the core
  after the slow call did. That a patch reached the hub before the slow call was answered isn't required: on a side
  that answers the render-back quickly it may not, and the patches' service doesn't depend on it.
- **"Their median with none"**: the same 15 patches (session and document) in the run without `--slow`.
- **"A fresh hub that plays every kept call"** is `deep-show run`, as #2694's suite reads the merge base's replies.
  Only `reply` is compared: `run` gives no presented revision, and the criterion says reply.
- **"The scenarios the suites play"** are played straight to a side, without a hub between, as #2694's suite drives
  one. Each call goes at the side's own time, not the scenario's `at`: the hub sends none.
- **Imports from another suite.** `scenarios.ts` imports `../806/scenarios.ts`, `../806/helpers.ts` (`FIGURE`) and
  `../393/helpers.ts` (`DOC`, `PANELS`; the test takes `putPng` from it), as #806's own replay tests do for the same
  scenarios. #1415's and #2694's helpers are imported by no other suite, so their few fixtures are written out there.
- **Scenarios left out.** #806's `settle` scenarios (one call each, a frame held by a fault: what they read is a
  time). #1415's state-table walk (42 scenarios, most on a `test-boom` build). #2694's 14,400 reads are 8 here: the
  count is its cost criterion's. #806's live tests and what its app draws need a hub and the app.
- **Why two runners.** The proof lanes give each `.mjs` file its own 20 minutes and run a change's `.ts` files in one
  run. The harness files and the script are `.mjs`; only the file that imports the other suites' TypeScript is `.ts`.

## What isn't asserted, because no criterion says so

- **When the side plays its kept calls again** (Scope, line 1: only when a session ended, or a claim, a pack or a
  record handle a kept call read changed). No surface says how often a side replays; criterion 1 reads the cost and
  criterion 3 the replies. A world change of a claim, a pack or a record handle is played by no test here.
- **That every render-back, not only the slow call, isn't kept**, and what `held` is after any other call.
- Any time in milliseconds, a call's wait, the 95th percentile, the GPU being opened once, a release build.
- The presented revision, what the app draws, and the hub's side (`packages/hub`).
- That `tests/acceptance/806/`, `393/`, `384/`, `1415/` and `2694/` pass on the change: they are their issues' proof
  and the lanes run them.
- That the kept outputs are committed and shown in the pull request.

## What the implementer adds outside this folder

- `docs/evidence/3262/`: the ten files the passing runs of `ac1-*` and `ac2-*` write there, committed with the change.
- `scripts/lanes-lists.mjs`: these files' runs pass two minutes, so they belong in `slow`; that list is edited under
  its own approval. `lane.json` already puts the folder in `alone`.
- Nothing else. A twin's file is replaced only as "The planted sides" says.

## What the base does

`BASE-FAILURE.txt` has each file's run at the base (`c8d9684f0`, the debug build), one at a time through the
machine's throttle, and each planted side's:

- `ac2-slow-call` fails at its assertion on both counts, each naming the render-back: the side held 17 calls after it
  and 16 before, and the 15 patches' median service was 470 ms behind it against 54.2 ms with none.
- `ac3-script` and `ac3-suites` pass, as tests of behaviour that must not change do, and fail on
  `keeps-hub-when-session-ends` at their assertion, naming the first call whose reply differs.
- `ac1-sessions-1`, `-4` and `-16` were not run: no test grant came within the 60 minutes this job may wait. Their
  judge was run against the spike's kept outputs of the same side, which it fails; that is not a run of the test.

Before the base was built, this job's checks were scripts outside the suite: every `.mjs` file parses; the TypeScript
files type-check; and the judges were run against planted inputs, 51 checks. `judgeGrowth` fails the
spike's three kept outputs (the merge base's) and passes the same rows with a flat service, exactly 1.25 times
passes and 1.255 fails; `judgeSlowCall` fails the spike's pair on both counts, each naming the render-back, passes
the pair with the render-back not kept and the patches no slower, and fails each fault alone; `freshPlan` and
`firstDifference` give the scenarios and name the first reply that differs; and the script's calls match the spike's
kept 16-session output session by session.

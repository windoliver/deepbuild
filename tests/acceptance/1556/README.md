# Acceptance tests for #1556: The Set up button freezes the window while setup runs

A blind job wrote these tests before any implementation of #1556 existed. It worked from:
- issue #1556 (its body as of November 6, 2026): Scope, the three acceptance criteria and Proof ("the planted `deep`
  through a replica click, and the planted lint hit");
- the design's Numbers version 0 has to hold (the app row, "canvas work on the UI thread"), How it installs (Setup:
  one click, one button) and Dogfooding;
- base commit `c12a65bb` (origin/main): `crates/deep-app/src/{setup,views,main}.rs`, `crates/deep-replica`
  (`src/main.rs`, `src/lib.rs`, `src/replica.rs`, `src/drive/`), `scripts/lanes.mjs` (the `lint` check),
  `scripts/proof-change.mjs` (criterion IDs);
- the conventions of `tests/acceptance/1002` (this folder's model) and `326/setup`.

Nothing of #1556 is implemented at the base. The implementing agent does not edit these files (AGENTS.md, Proof). A
dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `npm ci` done, and cargo on `PATH`:

```sh
cargo build --locked -q -p deep-replica --bin deep-replica    # macOS: the click
npx vitest run --root tests/acceptance/1556 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1556/tsconfig.json
```

- The helpers run the cargo build themselves if needed. No `Cargo.toml` was edited: there is no Rust test here.
- **Folders.** Every test makes its folders under `/tmp/da1556-*`. HOME is `<tmp>/h` for every process it starts; it
  never touches the real `~/.deepbuild` or `~/.claude`. The lint's commands get the real `CARGO_HOME` and
  `RUSTUP_HOME` (the toolchain) and the checkout's `target/` as `CARGO_TARGET_DIR` (a warm cache), nothing else of yours.
- **The plant is never in the repo.** `lint.test.ts` and the lint twins copy the checkout as it stands (tracked files
  and untracked ones git doesn't ignore, from the working tree, `node_modules` linked) to `/tmp/da1556-*/repo`, make
  it a git repo of its own (one commit for the checkout, one for the plant), and plant there.
- **Processes.** It stops only processes it started, by PID. Children get none of the runner's `DEEP_*`, `CLAUDE*`,
  `CODEX*`, `GIT_*` or `XDG_*` variables, nor a billing key.
- **Cache.** With `--root` here, Vitest writes its cache to `tests/acceptance/1556/node_modules/.vite/`. Delete it
  before committing.
- **Where it runs.** `lint.test.ts` and `twins.test.ts` run on macOS and Linux. `click.test.ts` needs macOS (the
  replica draws there only); elsewhere each test fails `BLOCKED`, never passes. This draft ran on Linux arm64, so
  the two click tests have not been run by this job (BASE-FAILURE.txt).
- **Time.** About 110 s on Linux at the base with `target/` warm: each scratch copy takes about 10 s, the lint lane
  over it about 40 s, the click twins about 30 s.

### How the lint lane runs

`lint.test.ts` reads the lane's commands from the scratch copy's `scripts/lanes.mjs` (`checks`, name `lint`), so a
lint the implementation adds to the lane, as a command, a clippy setting or a rule in one of its scripts, is run. It
runs them one by one in the copy, directly rather than through `runLanes` (whose throttle and lease machinery is the
machine's, not the lane's), stopping after the first command that fails naming the planted line. One change:
`cargo clippy --workspace` runs as `cargo clippy -p deep-app --no-deps` with the lane's other arguments
(`--all-targets --locked -- -D warnings`), as `scripts/affected.mjs` narrows clippy: deep-app is the only crate the
plant changes, a whole-workspace clippy at a fresh path costs a rebuild of every crate, and at the base clippy without
`--no-deps` stops in deep-canvas (a `type_complexity` error main has) before it lints deep-app. Any clippy
configuration the workspace or deep-app sets applies to that run (the `control clippy` twin shows a `clippy.toml`
reaches it). The copy links the checkout's `packages/*/dist`, which `conformance-lint` and `slots-check` read, so
build the workspaces first or those two report BLOCKED.

## The surface

### Pinned here: the implementation must provide these

1. **The replica click: `deep-replica --first-screen --click "Set up" --out <dir> --appearance light`.** The replica
   binary (`crates/deep-replica`, bin `deep-replica`, at `target/debug/deep-replica`) takes `--click <name>` beside
   the merged `--first-screen` (#1002). It draws the first screen for the HOME it runs with, then clicks the node
   whose role is `button` and whose name is `<name>`, as a mouse click (down and up at its bounds' center) delivered
   through the window on **the thread that draws its frames**, so a click handler that blocks holds back the next
   frame as it does in the app. From the click on it draws frames as the window would, **at least one every 50 ms of
   wall time whenever that thread is free**, advancing its clock by the wall time between them, until a frame shows
   what Set up said (the one line or the error), then exits 0; after 20 s with neither it exits 1. A missing button
   exits 2 naming it. It writes `<dir>/frames.jsonl` in both cases: one line per frame drawn after the click, in order,
   `{"ms": <wall-clock milliseconds from the click's delivery to that frame drawn>, "tree": <node>}`, each node
   `{"role", "name", "value", "bounds", "children"}` (`deep_replica::snapshot`'s node shape, the window's
   accessibility tree). Set up runs `deep setup` from PATH, as at the base. At the base `--click` is an unknown
   argument: exit 2, `deep-replica: unknown argument --click`.
2. **"Shows it's working"**: some node's name or value matches `/setting up|working/i`. **The one line**: a node
   naming the hooks, watch-only, the hub and `deep setup --undo` (#326's `SET_UP_LINE`). **The error**: a node whose
   text holds the failing `deep`'s stderr line, on one line.
3. **The lint lane fails naming the line.** With `std::process::Command::new("deep").output().is_ok()` planted in a
   `pub fn` of `crates/deep-app/src/views.rs` (before its test module), some command of the `lint` check other than
   `cargo fmt` exits non-zero and its output names `crates/deep-app/src/views.rs:<line>` (`:<col>` may follow; a path
   prefix may precede). How the lint is built is the implementation's choice.

### Merged surfaces, used as they are

- `deep-replica --first-screen` (#1002), the Set up button (role `button`, name `Set up`, #326) on the first screen
  of an empty home, Set up running `deep setup` from PATH (`crates/deep-app/src/setup.rs`), `SET_UP_LINE`.
- The `lint` check in `scripts/lanes.mjs`.

### The planted `deep`, first on PATH as `<tmp>/bin/deep`

It logs `start <args>` and `end <code>` to `<tmp>/deep.log`. `slow`: sleeps 3 s, exits 0. `failing`: sleeps 0.5 s,
writes `deep setup: the planted failure of #1556, on purpose` on stderr, exits 1.

## Criterion to tests

| ID | Criterion (short) | Tests | Wrong programs each fails on |
|---|---|---|---|
| `#1556.784e6b2f` | planted `deep` sleeping 3 s: a frame within 100 ms of the click showing it's working; main draws none for 3 s | `click.test.ts` (`judgeSlow`: first frame by 100 ms, one by 100 ms shows working, every frame until the outcome shows working, no gap over 500 ms, the one line shown no sooner than 2.9 s, the planted `deep setup` ran to its end, exit 0) | the base (no `--click`); twins `blocking` (main's logic: first frame at ≥ 3 s), `late`, `no-working`, `draws-then-blocks`, `early-line` |
| `#1556.ff055ca3` | planted failing `deep`: its one-line error still shows | `click.test.ts` (`judgeFailing`: a frame shows the stderr line, in one line; never the one line; the planted `deep` ran to its end; exit 0) | the base (no `--click`); twins `drops-error`, `error-two-lines` |
| `#1556.3f28018e` | planted `Command::output` in deep-app's UI code fails the lint lane, naming the line | `lint.test.ts` (scratch copy, plant, the lane's commands, `judgeLint`) | the base (nothing in the lane names the line); planted lint commands `off-by-one`, `file-only`, `warns`; the judge's synthetic wrong outputs |

### Wrong programs (`twins/`, runnable on any platform)

`twins/click.mjs <mode>` stands in for `deep-replica --first-screen --click "Set up"`: it runs the planted `deep
setup` from PATH and writes `frames.jsonl` in the pinned shape. They are written models, not the app.

| Twin | What it does wrong | Message it must fail with |
|---|---|---|
| the base | no `--click` surface | every tagged test (BASE-FAILURE.txt) |
| `blocking` | main's logic: `deep setup` blocking, no frame until it ends | "the window must draw a frame within 100 ms of the click; its first frame after the click came at 30xx ms" |
| `late` | first frame at 150 ms | "…within 100 ms of the click…" |
| `no-working` | frames on time, still the Set up button | "…must show it's working…" |
| `draws-then-blocks` | one working frame, then blocks | "the window drew no frame from 0 ms to 30xx ms after the click while setup ran" |
| `early-line` | the one line at once | "…must show it's working…" or "…before the planted deep setup (3 s) could have ended" |
| `drops-error` | "Set up failed." without deep's line | "…must still show its one-line error…" |
| `error-two-lines` | the error over two lines | "…must show its error in one line…" |
| `grep-lint.mjs off-by-one`, `file-only`, `warns` | names the next line; the file only; the line but exits 0 | "…must fail the lint lane, naming the line…" |
| synthetic lint outputs | another line, `<line>0`, file only, exit 0, `cargo fmt`'s diff, a compile error | the same, or `INVALID` for a plant that doesn't compile |

Positive controls, which must pass the same judges: `click.mjs right` (setup off the thread, both plants),
`grep-lint.mjs right` over the real planted scratch copy (the copy, the plant, the runner and the judge end to end),
synthetic clippy and script outputs naming the line, and `control clippy`: a `clippy.toml` banning
`std::process::Command::output`, written into the planted copy, makes the lane's narrowed clippy fail naming the line,
so the narrowed run reaches deep-app's code on this box despite main's own clippy error in `gpu_view.rs`. `blocking` with the failing plant passes the error judge on
purpose: criterion 2 is the error, not the timing. The twin and control tests carry no criterion tag.

## Disputes and assumptions a redraft may revisit

1. **The click surface.** The issue names a replica click but no entry point; the base's replica draws the first
   screen but clicks nothing from its CLI (`deep-drive` clicks, on its own virtual-clock protocol, not on the first
   screen of a home). `--click` beside `--first-screen` is the smallest surface that reaches the Set up
   handler headless and reports frames. Times are wall-clock because the planted `deep` sleeps in real time; a
   handler that blocks the drawing thread can't be seen on a virtual clock alone.
2. **The frame cadence and 500 ms gap.** "Main draws none for 3 s" is judged as the first frame's time (100 ms) and,
   beyond the criterion's letter, no gap over 500 ms before the outcome, so a handler that draws once and then blocks
   fails. The pinned cadence (one frame per 50 ms when free) makes 500 ms generous. A debug-build frame of the whole
   window is assumed to draw within 100 ms on the reference Mac; if it doesn't, a redraft may build the replica in
   release.
3. **"Shows it's working"** is judged by text, `/setting up|working/i`, on any node (a spinner needs an accessible
   name). The Set up button may stay or go while setup runs.
4. **The one line and the error.** The one line is #326's; the error is judged as holding the failing `deep`'s stderr
   line in one node, without a newline, as the base already shows it.
5. **The lint's reach.** The plant is a `pub fn` in `views.rs`, which holds both Set up buttons, so it is UI code
   whatever else the lint calls UI code. Whether an allowed use with a reason passes, and whether other blocking
   calls (`status`, `wait`, `spawn` then `wait`) are banned, is not tested.
6. **The lane run narrowed.** Commands run directly, clippy over deep-app (How the lint lane runs). A lint that only a
   whole-workspace clippy run would catch for a deep-app file isn't imagined. The lane may fail on main for unrelated
   reasons; the judge is the named line, not the exit code alone.

## Files

- `helpers.ts`: homes with the planted `deep`; the click through the replica and its frames; the click judges; the
  scratch copy, the plant, the lane's commands, their run and the lint judge.
- `click.test.ts`, `lint.test.ts`: the tagged tests. `twins.test.ts`: wrong programs and controls.
- `twins/click.mjs`, `twins/grep-lint.mjs`: the wrong programs and controls above.
- `tsconfig.json`: type-checks the suite under the root's strict options.
- `BASE-FAILURE.txt`: the run at the base, trimmed to each test's reason.

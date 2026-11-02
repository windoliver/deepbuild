# Acceptance tests for #140 (platform group): the wasm32 build, the network seam's suite, the window seam's capabilities, and the seams' budgets

Written first, from issue #140 ("Canvas platform seams: one interface per platform part, macOS backends first, each
with its conformance suite": its scope, its Seam and backend fields and "It can never" list, its 22 acceptance
criteria and its proof line), its oracle page, the design sections it links and those they lean on, and base commit
`f41a5b3e` ("Merge pull request #888 …"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

This folder holds four of the issue's criteria, numbered as the issue lists them: **12, 13, 14 and 18**. Two other
blind jobs write the rest in parallel: `tests/acceptance/140/gpu/` (1, 5, 9, 11, 16, 17, 19, 20, 21, 22) and
`tests/acceptance/140/view/` (2, 3, 4, 6, 7, 8, 10, 15). The oracle page links an upstream test for criterion 1 only,
so nothing upstream is ported here; these tests are the local proof for their four criteria.

What was read:

- `docs/technical-design.md`: How it installs, the platform seams (2465–2474: each seam's backends; "Each version
  passes the same conformance tests before its platform ships … every network message delivered once and in order
  through a test relay that delays, drops, duplicates and reorders, with nothing sent before Join or to another
  host"; "From R2 the canvas core's crates also build for wasm32 with threads off in the local preflight, so nothing
  native-only creeps in"); How we know version 0 works (conformance kits, planted fakes, a probe the backend can't
  make is BLOCKED); Every task carries its own budgets and The reference Macs (2418–2420: five runs after warm-up, the
  margin, the merge base, INCONCLUSIVE off the reference Macs); the canvas core's modules (2694); the web player
  (2703).
- `docs/canvas-primitives.md`: Seam and backend (1201: the fields, "a backend is a canvas module … chosen at build
  time", "its suite needs every message delivered once and in order through a test relay that delays, drops,
  duplicates and reorders, with nothing sent before Join or to another host", the suite's interop part with relay@1);
  Seam and backend: device classes; Question card (786: `arm_after: 500 ms`, `rearm_on: … occluded | display |
  activation`, "It arms after the interval while still and unobscured", "It can never: be covered, even partly");
  Frame clock and scheduler; Window and display placement; Input router; Net `net@1`, Net: relay and Join, Net:
  relay protocol `relay@1` (the message frame, the repeat rule that recovers drops, "no network until a person clicks
  Join, and then only the declared relay"); the checks `net.rollback` … (8455: "over a test relay, with no network");
  Cold, warm and while authoring and the budget classes (88).
- At the base: AGENTS.md; `tests/acceptance/377/` (binaries per feature set, `--planted`, the reference-Mac gate and
  judge, the noop lane read from `scripts/lanes.mjs`), `379/` (the perf lane's class records through
  `benchmarks/canvas.mjs`), `400/` (`deep-show run` on the virtual display clock: displays, windows, `activate`,
  the card's states, the Driver), `105/` (the load gate, the perf-lane task valid against the merge base); `crates/`
  (`deep-show`'s `run`, its startup `--planted`, `src/placement.rs`'s card and occlusion by the app's own windows),
  `scripts/lanes.mjs`, `scripts/canvas-lint.mjs` (the canvas prefix), `scripts/benchmark.mjs`,
  `benchmarks/canvas.mjs`, `benchmarks/budgets.json`, `.cargo/config.toml`, `rust-toolchain.toml`.

What the base already does and these tests don't credit: `deep-show run` plays the hub's canvas side on #400's
virtual displays, with `activate` (the window server's key-window report), the question card's states, and occlusion
by the app's own windows; `benchmarks/canvas.mjs class <class>` records each budget class's fixture (#379); the
perf lane compares its tasks with the merge base. There is no seam, no backend table, no capability table, no
network seam or suite, no test window backend, no `wasm32` or `seams` lane, and the toolchain has no wasm32 target
installed.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/140/platform --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/140/platform/tsconfig.json   # type-check
```

`network.test.ts` and `window.test.ts` first build `deep-show` once per feature set they use (`cargo build --locked
--bin deep-show`, and `--features test-window`), copy each out of `target/debug` under its own name into a temporary
folder, and fail each test that uses a build that failed. Each test writes into its own temporary evidence folder
and deletes it. The tests use node built-ins and vitest only. A run with `--root` may leave Vitest's cache in
`tests/acceptance/140/platform/node_modules/.vite`; delete it.

`scripts/lanes.mjs` needs, and this README is the instruction (the implementer makes these edits):

- `tests/acceptance/140/platform/` in `alone`, the unit lane's one-at-a-time list, since the files build cargo
  binaries and `budgets.test.ts` times budgets;
- a lane `{ name: 'wasm32', commands: [[process.execPath, 'scripts/wasm32.mjs']] }` in `checks` (criterion 12);
- a lane `{ name: 'seams', commands: [[process.execPath, 'scripts/seams.mjs']] }` in `checks` (criterion 18, and
  the scope's "a conformance suite per seam in the local preflight").

`benchmarks/budgets.json` needs the task `seam-suites` (criterion 18, below).

`budgets.test.ts` is slow by design: five timed runs of every seam's suite, and every budget class's fixture recorded
on this checkout and on its merge base, which it exports with `git archive` into
`target/acceptance-140-platform-base/<sha>/` (git-ignored, kept so later runs build warm) and builds there. Its
timings count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, with Low Power Mode off, a nominal thermal
state and a 1-minute load at most the core count; elsewhere each timing test skips as `INCONCLUSIVE` with the reason,
after its structural checks have run. It never passes by skipping. With HEAD its own merge base (after the merge),
the frame-time test is INCONCLUSIVE: there is nothing to compare.

`BASE-FAILURE.txt` is the run at the base.

## The command that runs every seam's suite

```sh
node scripts/seams.mjs
```

It runs every seam's conformance suite (the gpu and view groups' suites included) and is the lane `seams` and the perf
task `seam-suites`. Criterion 18's "the conformance suites run in under 3 minutes" times this command.

## The surface under test

The issue names the seams, their backends and suites, a test relay, a test window backend, a question card, the
canvas core's crates, a wasm32 build in the local preflight and budgets against the merge base, but no command or
API. So these tests extend what exists (`deep-show run`, `scripts/lanes.mjs`, `benchmarks/canvas.mjs`,
`benchmarks/budgets.json`) with the smallest set of entries they need, after the earlier suites' conventions, and add
two scripts. No new binary.

### Criterion 12: `scripts/wasm32.mjs` and the lane `wasm32`

- `node scripts/wasm32.mjs` builds every canvas core crate (below) for `wasm32-unknown-unknown` with threads off (the
  target as rustc ships it, without the `atomics` target feature, no `-Zbuild-std`), and fails a crate whose own
  code or whose dependencies need threads or an API only native targets have. It prints one line `PASS <crate>` per
  canvas core crate it built and exits 0; on a failure it prints a line `FAIL <crate>: <reason>` naming the crate that
  broke the build (the planted dependency's own name, for a planted run) and exits non-zero. Anything else it prints
  isn't read.
- `--planted threads` runs the same build with a planted dependency crate `deep-planted-threads` under `deep-canvas`,
  whose code needs threads (it spawns a `std::thread`); `--planted native` with `deep-planted-native`, whose code
  calls an API only native targets have (such as `std::os::unix`). Each is reachable only through `--planted`, never
  in the clean run or the shipped build. A plain `std::thread::spawn` compiles for wasm32-unknown-unknown and fails
  only at run time, so the lane must catch a dependency that needs threads by more than the compiler's errors.
- The canvas core's crates, as the tests read them from `cargo metadata`: every workspace crate named `deep-canvas` or
  `deep-canvas-*` except the test-only `deep-canvas-test-modules`, plus `deep-text`. At least these; the script may
  build more.
- The tests also build those crates for wasm32-unknown-unknown themselves (`cargo build --locked --target
  wasm32-unknown-unknown -p …`, with RUSTFLAGS and the target's flags cleared), so the wasm32 target must be installed
  for the toolchain in `rust-toolchain.toml` (`targets = ["wasm32-unknown-unknown"]` there, or `rustup target add`).

### Criterion 13: the network seam's suite in `deep-show run`

A scenario `{"evidence": dir, "calls": [{"call": "seam_suite", "seam": "network", "messages": 10000, "seed": n}]}` runs
the network seam's conformance suite on the seam's correct test backend, through the suite's local test relay, which
delays, drops, duplicates and reorders the messages by the seed. Its reply:

```json
{"seam": "network", "suite": string, "backend": {"name": string, "version": string},
 "status": "PASS" | "FAIL", "faults": [string],
 "relay": {"messages": n, "delayed": n, "dropped": n, "duplicated": n, "reordered": n},
 "hosts": {"given": [host], "connected": [host]}, "sent_before_join": n,
 "sent": [id], "delivered": [id]}
```

`relay.messages` is how many messages the relay carried; each other count how many it delayed, dropped, duplicated or
reordered. `hosts.given` are the hosts the suite gave the backend (the relay's), `hosts.connected` every host the
backend opened a connection to. `sent_before_join` counts what the backend sent before the suite's join call. `sent`
is each message's ID in the order the sender handed it to the backend; `delivered` each ID in the order the receiving
backend handed it on, every arrival listed, duplicates included. `faults` names each fault the suite found, from these
codes: `delivered_twice`, `out_of_order`, `sent_before_join`, `unlisted_host` (others may be added for other faults);
`status` is PASS only with no fault.

### Criterion 14: the test window backend in `deep-show`

- The build `cargo build --locked --bin deep-show --features test-window` chooses the window seam's test backend for
  the app's windows (a backend is chosen at build time). It declares no occlusion report, so it never tells the app
  which windows of other apps lie over its own. The shipped build keeps its own window backend.
- `{"call": "window_caps", "at"}` → the capability table of the build's window and input backends:

  ```json
  {"backend": {"name": string, "version": string},
   "caps": {"occlusion" | "positions" | "pointer_lock" | "warp_cursor" | "ime":
             {"declared": bool, "consumers": [{"consumer": string, "when_absent": string}]}}}
  ```

  `occlusion`: whether the backend reports occlusion; `positions`: whether it sets and reads window positions;
  `pointer_lock`, `warp_cursor`; `ime`: whether it composes text through an input method. `consumers` lists what
  reads each capability, and `when_absent` names that consumer's behavior when the capability is absent. The question
  card is the consumer `question_card` of `occlusion`.
- The platform's own reports in the test window backend, beside #400's scenario (one display, the main window):
  `{"call": "activate", "at", "window": ID | null}` (#400's: the window server's report that the window became key,
  or with `null` that you switched to another app), and `{"call": "frontmost", "at", "window": ID, "frontmost":
  bool}`, the backend's report that the window is (or is no longer) frontmost. A window the backend has reported
  neither active nor frontmost isn't.
- `{"call": "test_window", "at", "id": string, "rect": [x, y, w, h] | null}`: a window of another app that the test
  window backend stacks above every window of the app, in global points; `null` closes it. With no occlusion report,
  the backend never tells the card about it: the test sends the `frontmost` report the platform would make.
- The card is #400's `{"call": "card", "at"}` reply (`rect`, `window`, `states`). In the test-window build it arms
  only while its window has been active and frontmost by those reports for the 500 ms interval (on its display's vsync
  grid, as #400's), and a change to either is a re-arm (`rearm_on: activation`, `occluded`).
- `deep-show run --planted card_ignores_unknown_occlusion`: the wrong card, which treats the unknown occlusion as
  unobscured and so arms as #400's card does, reading only the app's own windows.

### Criterion 18: the lane `seams`, `scripts/seams.mjs` and the frame-time reports

- `node scripts/seams.mjs` (above) exits 0 when the suites pass, and its last stdout line is
  `{"conformance": {<seam>: {"suite": string, "status": string, "backend": {"name", "version"} | null}}}` with an
  entry for each of the issue's thirteen seams: `gpu`, `surface`, `display`, `fonts`, `accessibility`, `input`,
  `color`, `codecs`, `audio`, `capture`, `cpu`, `headless`, `network` (the Fields' `conformance: {seam → suite}`).
- `benchmarks/budgets.json` has a task `{"id": "seam-suites", "command": ["node", "scripts/seams.mjs"], …}` whose
  `initialReason` names #140, valid against the merge base's budgets by `validateBudgets`.
- `node benchmarks/canvas.mjs class <class>` (#379's) adds `backends: {<seam>: {"name", "version"}}` to its report,
  naming at least the `gpu` seam's backend that drew the frames.

### Planted programs

| Selected by | The wrong program | Criterion |
|---|---|---|
| `scripts/wasm32.mjs --planted threads` | a dependency `deep-planted-threads` under deep-canvas that spawns a std thread | 12 (issue-named) |
| `scripts/wasm32.mjs --planted native` | a dependency `deep-planted-native` under deep-canvas that calls a native-only API | 12 (issue-named) |
| `deep-show run --planted net_delivers_twice` | a network backend that delivers a message twice | 13 (issue-named) |
| `deep-show run --planted net_delivers_out_of_order` | one that delivers two messages out of order | 13 (issue-named) |
| `deep-show run --planted net_sends_before_join` | one that sends before its join call | 13 (issue-named) |
| `deep-show run --planted net_connects_unlisted_host` | one that connects to a host it wasn't given | 13 (issue-named) |
| `deep-show run --planted card_ignores_unknown_occlusion` (test-window build) | a card that treats unknown occlusion as unobscured | 14 (issue-named) |

## Criteria to tests

Each test's name starts with `#140.<n>`, the criterion's number in the issue.

| # | Criterion (the issue's text, shortened) | Tests and what each asserts | Surface |
|---|---|---|---|
| 12 | The canvas core's crates build for wasm32-unknown-unknown with threads off in the local preflight, and a planted dependency that needs threads or an API only native targets have fails that build, naming the crate | `wasm.test.ts`: a lane `wasm32` in `checks` runs `node scripts/wasm32.mjs`; every command exits 0; a `PASS <crate>` line for each canvas core crate. Apart from the lane: `rustc --print cfg` for the target has no `target_feature="atomics"`, `.cargo/config.toml` adds no atomics or build-std, and `cargo build --locked --target wasm32-unknown-unknown -p <each core crate>` exits 0. `--planted threads` and `--planted native` each exit non-zero with a `FAIL` line naming `deep-planted-threads` / `deep-planted-native`, where the clean run passed | lanes.mjs, `scripts/wasm32.mjs`, cargo |
| 13 | The network seam's suite fails four planted backends, naming the fault, and passes a correct test backend through a local test relay that delays, drops, duplicates and reorders 10,000 messages | `network.test.ts`: seeds 1, 2 and 3 on the correct test backend: the relay carried 10,000 messages and delayed, dropped, duplicated and reordered some; this file's own check of `sent` against `delivered` finds every message once and in order; nothing sent before join; every connection to a given host; `faults` empty, PASS. Each planted backend: the reply's data shows its fault (a duplicate or an inversion in `delivered`, `sent_before_join` > 0, a host not given), `status` FAIL, `faults` holds its code and none of the other three | `deep-show run` `seam_suite`, `--planted` |
| 14 | A test window backend that declares no occlusion report makes the question card arm only while its window is active and frontmost by the platform's own report; a planted card that treats unknown occlusion as unobscured arms under a covering test window and fails, naming the capability | `window.test.ts`: the capability table (the five capabilities, occlusion not declared, the question card among its consumers, every absent capability's consumers naming their behavior; the shipped build's table from another backend). The card with reports active+frontmost, then inactive, active again, not frontmost, frontmost again: armed only inside spans where both held for 500 ms, within a frame of 500 ms into each such span, never 600 ms into a span where either failed. With no reports, never armed. Under a covering window of another app (active, not frontmost) for 1.5 s: never armed under it, armed 500 ms after it leaves; the planted card arms under it and the check fails naming `capability occlusion` and the window | `deep-show --features test-window`, `window_caps`, `activate`, `frontmost`, `test_window`, `card`, `--planted` |
| 18 | Budgets, on the reference Mac in the local preflight, compared with the merge base: the seams add under 1% to the canvas budget fixtures' frame time, and the conformance suites run in under 3 minutes | `budgets.test.ts`: the perf task `seam-suites` (valid against the merge base's budgets, naming #140); the lane `seams` runs `node scripts/seams.mjs`, which exits 0 and maps all thirteen seams to a suite; five timed runs after a warm-up, each under 180 s by the design's judge. Each budget class's fixture (`canvas.mjs class`) on this checkout and on its merge base: the report names `backends.gpu`; every warm run's p95 GPU and CPU frame time within 1.01 × the merge base's median for that class, by the design's judge | lanes.mjs, `scripts/seams.mjs`, budgets.json, `benchmarks/canvas.mjs` |

The proof line ("Each seam's suite passing on the reference Mac, a planted backend fault failing its suite, and the
list of results with their backends") is, for this group, the network suite's PASS and its four planted FAILs, and
`scripts/seams.mjs`'s map of seams to suites.

## Readings where the issue and design leave a choice

- **The canvas core's crates** (12) aren't listed anywhere. Read as the core and its canvas modules, the crates the
  canvas lint scopes by the prefix `deep-canvas`, without the test-only modules, plus `deep-text`, the canvas's one
  text shaper with bundled fonts, which the web player needs. The render crates (`deep-gpu`, `deep-*-render`,
  `deep-marks-vello`) and the GPUI ones aren't required: the web's own backends (wgpu on WebGPU, the page's canvas)
  come with the web player in R6, outside this task. The implementer may build more.
- **"Threads off"** (12) is the wasm32-unknown-unknown target without the `atomics` target feature, as rustc ships it;
  **"a planted dependency that needs threads or an API only native targets have"** is read as two planted runs, one of
  each kind, each of which must fail, since the criterion names both. "Naming the crate" is the planted dependency's
  name on a `FAIL` line.
- **The network suite's evidence** (13): the suite's verdict is a check result, but this file doesn't take it alone
  (invariant 1): the reply carries what was sent and delivered and the relay's counts, and the test checks them itself.
  "Every message arrives once and in order" is read at the receiving backend, against the order the sender handed them
  over; the relay's own frames and repeats (relay@1's repeat rule) aren't read. "Nothing is sent before the join call"
  and "no connection goes to a host it wasn't given" are read from the reply's `sent_before_join` and `hosts`.
  The relay@1 interop part and `net.rollback` belong with the real backends (#309, #179), not here.
- **"Active and frontmost by the platform's own report"** (14): active is #400's `activate` (the key window); frontmost
  is a report of its own, since a window of another app can float above the key window without taking activation (a
  non-activating panel), which is the case the planted card fails on. A window no report has named active and
  frontmost isn't: unknown is not cleared. "Fails, naming the capability" is the test's failure sentence, which names
  `capability occlusion` and the covering window.
- **The window seam**: the Fields list no `window` seam; the scope says "the window and input seams declare
  capabilities". The capability table is one call over both and names no seam per capability.
- **"Compared with the merge base"** (18): the frame-time share needs both sides measured, so the test records each
  class's fixture on this checkout and on an export of the merge base, and judges this checkout's five warm runs
  against 1.01 × the base's median, by the design's rule (so a difference under the margin reads INCONCLUSIVE, not
  PASS or FAIL). The three minutes is the issue's own number, judged on five runs; its merge-base comparison is the
  perf lane's task, as #105's and #401's are. The class report naming `backends.gpu` is how the test knows the frames
  it measures go through the seams; at the base it names none.
- **The reference-Mac gate** follows the design and #105: mains power, Low Power Mode off, a nominal thermal state and
  a load at most the core count. (#377's owner change dropped mains for that suite only.)

Not tested here, because the other groups' criteria hold them: the GPU feature table and exact-class fixtures, the
surface's sRGB tag, presentation timing, glyph runs and fonts, accessibility, capture, results naming their backends
and cache misses on a new version, render-back, deep doctor, quirks, adapter choice, validation, the locale, device
loss and the uncaptured-error channel.

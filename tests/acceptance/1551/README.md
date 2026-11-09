# Acceptance tests for #1551: a still window stops its display link, and canvas-idle reads a shown window

A blind job wrote these tests before any implementation of #1551 existed. The implementing agent doesn't edit them
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). It worked from:

- issue #1551 (its body as of November 8, 2026): the problem statement, Scope, the four acceptance criteria and
  Proof ("the callback counts on the merge base and the change, and the planted waker"); its epic #241; its
  dependency #1426 (closed: the carried-patch table and `scripts/vendor-rebase.mjs`); #404 (input on screen within
  2 frames, measured per input from its arrival at the app to the presentation time of the first frame that reads
  it, p95 over test inputs at seeded times);
- the design: docs/canvas-primitives.md, "Frame clock and scheduler" ("stops the display link when idle"; Cost
  "Idle: 0 frames and 0 wakeups as the target, with wakeups reported"; per window `caps: {hidden: 0}`) and "Frame
  callback and presentation feedback"; docs/technical-design.md, Dogfooding and the reference Macs;
- the base commit `dd83ac2f`: `vendor/gpui-pre/src/platform.rs` (`frame_waker` defaults to `None`,
  `schedule_frame` is a no-op by default), `vendor/gpui-pre/src/window.rs` (the request-frame closure registered
  through `on_request_frame`, `WindowInvalidator` and `wake_platform`, `on_next_frame`, `refresh`, the present-only
  path through `require_presentation` and `needs_present`), the registry crate `gpui-pre-macos` 0.3.9
  (`src/window.rs`: `step` runs the request-frame closure each display-link tick; `start_display_link` and
  `stop_display_link` follow occlusion only), `crates/deep-show/src/watch.rs` (`deep-show live`, the app's real,
  shown window), `crates/deep-marks-render/src/macos.rs` (`idle`: a headless window on `thread::sleep`),
  `benchmarks/canvas.mjs` (`idle`, `judge`), `benchmarks/budgets.json` (`canvas-idle`), `scripts/benchmark.mjs`
  (`judgeLimit`), `scripts/proof-change.mjs` (criterion IDs), `vendor/gpui-pre-apple/upstream/README.md`,
  `scripts/vendor-rebase.mjs`, `.cargo/config.toml`, and the suites `tests/acceptance/854` (`idle.test.ts`, the
  lane's record-and-judge shape) and `tests/acceptance/140/view` (`timing.test.ts` and its helpers: driving
  `deep-show live`, INCONCLUSIVE on a machine that can't show a window or whose timing doesn't count).

Nothing of #1551 exists at the base: `deep-show live` counts no request-frame callbacks and has no `wake`, no
`window` reading and no plants of this issue; `canvas-idle` runs headless and its judge reads no window;
`gpui-pre-macos` comes from crates.io. `BASE-FAILURE.txt` records what was run at the base.

## The criteria and their tests

| ID | Criterion | Test |
|---|---|---|
| `#1551.529faaf6` (C1) | A shown window holding a still document for 60 s runs 0 request-frame callbacks. The merge base reads at least 3,000 at 60 Hz. A planted link that never stops fails, naming the count | `window.test.ts`: the still board (`benchmarks/canvas/still.json`) in `deep-show live`, watched for 60 s from the moment it settles: `live.request_frames` is 0 and `live.window.state` is `shown`. Planted `link_never_stops`: at least 3,000 in the minute, and the check's failure names the count. The merge base through `DEEP_1551_BASE_BIN`: at least 3,000 |
| `#1551.d7b41417` (C2) | From that idle state, a hub event, a `notify` from another thread and a present-only request each reach the screen within 2 frames. A planted waker that ignores `schedule_frame` fails, naming the request | `window.test.ts`: after the still minute, in the same run, `hub_event`, `thread_notify` and `present_only` three times each, 1.5 s apart, each from idle (`request_frames_before` 0): each one's frame presented within 2 refresh periods of the request. Planted `waker_ignores_schedule_frame`: at least one request misses, and the failure starts with its kind and time |
| `#1551.5ed5fd2b` (C3) | `canvas-idle` reads a shown window, and reads INCONCLUSIVE when it's hidden, covered or the display is asleep. A headless reading can't PASS the lane | `lane.test.ts`: the judge on made-up readings: five runs shown pass the `window` entry; run 3 `hidden`, `covered` or `display_asleep` reads INCONCLUSIVE, naming run 3 and the state; the merge base's shape (no window reading) reads `headless` and isn't PASS. Then one real `node benchmarks/canvas.mjs idle` on this Mac: every run's window shown for its whole minute, and the judge's `window` entry passes |
| `#1551.76b01721` (C4) | Input from idle shows within #404's 2 frames, compared with the merge base. A link that needs a full extra refresh to restart fails, naming the frames | `window.test.ts`: after the requests, in the same run, 20 `input` wakes at seeded times a second apart, each from idle: p95 of (presented − arrival) ÷ refresh within 2. Planted `link_restarts_a_refresh_late`: p95 past 2, the failure naming each late frame. The merge base's p95 is read beside the change's in the base test |
| Scope | "`gpui-pre-macos` isn't vendored, so this adds a vendored crate and a row in #1426's table" | `vendored.test.ts`: Cargo.lock resolves `gpui-pre-macos` from a path; `vendor/gpui-pre-macos/Cargo.toml` is that crate at the locked version; the carried-patch table has a `#1551` row naming a file under `vendor/gpui-pre-macos/`; `node scripts/vendor-rebase.mjs check` exits 0 with no `FAIL` or `BLOCKED` line |

A test tagged with two IDs serves both. The base test (`DEEP_1551_BASE_BIN`) carries C1 and C4.

## The surface under test

Every name below is new unless marked as the base's. The implementation provides each exactly as written.

### `deep-show live`: the `live` object (the #140 view README's, extended)

The base's options stay as they are (`pace_hz`, `watch_from`, `watch_ms`, `tree`, `after`, `hold_ms`). New:

```json
"live": {"watch_from"?: "settled", "watch_ms"?: n,
         "wake"?: [{"after_ms": n, "by": "hub_event" | "thread_notify" | "present_only" | "input", "call"?: Call}]}
```

- `wake`: requests made of the window once it has settled (the moment the base's `watch_from: "settled"` names:
  every latched frame presented and the frame clock idle). A `wake` list makes the run settle, as `tree` does. Each
  wake is made `after_ms` after that moment; the tests space them at least 1 s apart and after the watch ends.
  - `hub_event`: `call` (required for this kind) is played through the hub as `after`'s calls are; the tests send
    a `deep_show` of the still board with its label changed, so a new revision becomes current and the window
    must show it.
  - `thread_notify`: a thread of the process other than the main thread notifies the window's view, as anything
    off the main thread (a hub socket's reader, a worker) would; the view draws on its next render.
  - `present_only`: the window asks for its last drawn frame to be presented again without a redraw (GPUI's
    present-only path: a frame request with `require_presentation`, or `needs_present`).
  - `input`: an input event is posted into AppKit's event queue for the window (`NSApplication.postEvent:atStart:`,
    such as a pointer move over the panel), and the window handles it as real input by drawing a frame.

Answer `{"ok": true, "replies": [...], "live": Live}` as at the base, `Live` gaining:

```json
Live: {...the base's fields...,
       "request_frames": n,
       "window": {"state": "shown" | "hidden" | "covered" | "display_asleep", "shown_ms": n},
       "wakes": [{"after_ms": n, "by": string, "requested_ns": n, "request_frames_before": n,
                  "frame_seq": n | null, "presented_ns": n | null, "refresh_ns": n}]}
```

- `request_frames`: how many times the window's request-frame closure ran within the watch: the closure GPUI's
  `Window` registers through `PlatformWindow::on_request_frame`, counted at its entry whatever called it (the
  display link's `step`, `display_layer`, a key-window change). Present whenever `watch_ms` is.
- `window`: what the window was from the moment it settled to the end of the run (the watch and every wake).
  `state` is `shown` only when the window was ordered in, AppKit reported it visible (`occlusionState` holds
  Visible) and its display was awake throughout; otherwise the first other state it entered: `hidden` (ordered out
  or minimized), `covered` (ordered in but occluded) or `display_asleep` (its display asleep). `shown_ms`: how long
  it was shown in that span. A test reads a run whose window wasn't `shown` as INCONCLUSIVE.
- `wakes`: one entry per asked wake, in order, with its `after_ms` and `by`.
  - `requested_ns`: when the request was made, on the host's monotonic clock in ns (the clock `presented_ns` and
    the base's `frames` use): for `hub_event` when the call is played, for `thread_notify` on the notifying thread
    just before it notifies, for `present_only` when it's asked, and for `input` when the window's input callback
    (GPUI's `on_input`) receives the event, its arrival at the app (#404).
  - `request_frames_before`: request-frame closure runs in the 500 ms before `requested_ns`. 0 means the request
    came to an idle window, its link stopped.
  - `frame_seq`, `presented_ns`: the first frame presented in answer to the request (for `present_only`, the
    first drawable presented after it; for the others, the first frame latched after `requested_ns`), with its
    presented time from the presentation feedback (the base's hook: the drawable's `presentedTime`). Both `null`
    when no such frame was presented within 500 ms of the request.
  - `refresh_ns`: the display's refresh period, 1e9 ÷ `display.refresh_hz`.

A machine where no window can be shown answers `{"ok": false, "code": "no_display"}`, as at the base: INCONCLUSIVE.

### `deep-show live`: the plants (the scenario's top-level `planted`, as deep-show's other plants)

| Name | The wrong program | Caught by |
|---|---|---|
| `link_never_stops` | The display link keeps running, and its `step` keeps running the request-frame closure, while the window is still: the merge base's behavior, on the change's build | C1: at least 3,000 callbacks in the minute; the failure names the count |
| `waker_ignores_schedule_frame` | The link stops when idle, but `schedule_frame` doesn't restart it; only `frame_waker` does | C2: at least one of the three requests misses 2 frames (or never presents); the failure names its kind and time |
| `link_restarts_a_refresh_late` | The link stops when idle, and on restart its first request-frame callback comes one full refresh later than the link would otherwise give it | C4: input from idle reads past 2 frames at p95; the failure names each late frame |

Each plant is otherwise the change: the same counting, wakes and window reading.

### `canvas-idle` (`node benchmarks/canvas.mjs idle`) and its judge

The report keeps #854's shape (`task`, `fingerprint`, `fixture`, `seconds`, `runs` with `opened_frames`, `seconds`,
`frames`, `drawn`, `wakeups`, `cpu_ms`, `cpu_fraction`); the still document is held in a shown window, so each run
also carries:

```json
{"request_frames": n, "window": {"state": "shown" | "hidden" | "covered" | "display_asleep", "shown_ms": n}}
```

with `request_frames` and `window` meaning what they mean for `deep-show live`, over the run's still minute.

`node benchmarks/canvas.mjs judge` on a `canvas-idle` report adds to its verdict:

```json
"window": {"status": "PASS" | "INCONCLUSIVE", "runs": ["shown" | "hidden" | "covered" | "display_asleep" | "headless"], "reason"?: string}
```

- `runs`: each run's `window.state`, or `headless` for a run with no `window` reading (the merge base's runs).
- `status`: `PASS` when every run is `shown`, otherwise `INCONCLUSIVE`; `reason` then names each run not shown by
  its number and state, such as `run 3: covered`.
- The verdict's `status` is never `PASS` while `window.status` isn't. A reading with a run hidden, covered or on a
  sleeping display, and frames within the target, reads `INCONCLUSIVE`.

### The merge base: `DEEP_1551_BASE_BIN`

The merge base's `deep-show live` reports none of the above, so it can't be read as it stands. The base test runs
the shipped scenario on `DEEP_1551_BASE_BIN`: a `deep-show` built from the merge base with only the measuring
surfaces above added (`request_frames`, `window`, `wake` and `wakes`) and nothing that changes when the link runs or
stops, for example:

```sh
git worktree add /tmp/base-1551 "$(git merge-base HEAD origin/main)"
# apply only the measuring part of the change there, then:
cargo build --locked --release -p deep-show --bin deep-show   # in /tmp/base-1551
DEEP_1551_BASE_BIN=/tmp/base-1551/target/release/deep-show npx vitest run --root tests/acceptance/1551 window -t 'merge base' --testTimeout=600000
```

Unset, that test reads INCONCLUSIVE (it fails saying so), never PASS. Its readings, the merge base's callbacks and
its input p95 beside the change's, are printed and belong in the PR.

## How to run

On a Mac with a display, logged in, the screen awake and unlocked; Node 24 and `npm ci` done; cargo on `PATH`:

```sh
npx vitest run --root tests/acceptance/1551 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1551/tsconfig.json
```

- `window.test.ts` builds a release `deep-show` once and copies it out. It shows a window four times: the shipped
  run (about 100 s: the 60 s still minute, then 9 requests and 20 inputs), `link_never_stops` (about 65 s),
  `waker_ignores_schedule_frame` (about 15 s) and `link_restarts_a_refresh_late` (about 22 s); and a fifth, about
  100 s, with `DEEP_1551_BASE_BIN`. Don't cover the window or let the display sleep while it runs: a run whose
  window wasn't shown reads INCONCLUSIVE.
- `lane.test.ts` runs the real lane once (a release build, then a 5 s warm-up and five 60 s runs: over six minutes)
  and the judge on made-up readings (seconds).
- `vendored.test.ts` runs `vendor-rebase.mjs check`, which reads each pinned release from the network once, then
  from `~/.cache/deepbuild/vendor-releases`; with neither it reads INCONCLUSIVE.

## INCONCLUSIVE, never PASS

- No window can be shown here (`no_display`), or the window or a lane run wasn't shown throughout: INCONCLUSIVE.
- A timing (C2's requests, C4's inputs) misses 2 frames off a fit reference Mac (the perf lane's three: Mac15,7 /
  Apple M3 Pro / 36 GiB, Mac15,12 / Apple M3 / 16 GiB, Mac17,10 / Apple M5 Max / 64 GiB; mains power, Low Power
  Mode off, thermal state nominal) or with the 1-minute load above half the cores: INCONCLUSIVE, the readings
  attached. The same holds for a plant that stays within 2 frames there. A count
  (C1's callbacks) is judged on any Mac.
- `DEEP_1551_BASE_BIN` unset: the base test is INCONCLUSIVE.

## Notes for the implementer and the reviewer

- 2 frames is #404's bar at the display's rate: on a 120 Hz ProMotion display that is 16.7 ms from a request to its
  frame's presented time. C2 asks it of every request, three of each kind; C4 of the p95 over 20 inputs.
- C3's real run proves the lane reads a window it reports shown; that a lane detects a covered window or a
  sleeping display is proven only through the judge's made-up readings, and through a real run that happens to be
  covered, which must then read INCONCLUSIVE.
- `tests/acceptance/854/idle.test.ts` judges a made-up `canvas-idle` reading with no window and expects PASS. C3
  says a headless reading can't PASS, so that one #854 expectation conflicts with this issue's criterion; this
  suite doesn't edit #854's. (At the base that #854 test already reads INCONCLUSIVE, since `judge` passes no load
  readings to `judgeLimit`.)

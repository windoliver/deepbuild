# Acceptance tests for #1546: a change reaches the window by itself, and the replica draws only the frames a real window would

Written first, blind, from issue #1546 (its problem, Scope, four acceptance criteria, Proof, Not in scope, Depends on), the design
and the base commit `dd83ac2f` (origin/main), by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read: `AGENTS.md`; `docs/technical-design.md` (Replica; How we know version 0 works; Dogfooding; the view row's
sentences on session rows, "a row whose source went quiet is dimmed with when it was last seen"; States people see, `quiet`);
`docs/canvas-primitives.md` (Frame clock and scheduler: "the record, bound values and the ages views show reach chrome through
state the views observe, so a change marks the window dirty by itself, and the replica can draw only the frames a real window
would, comparing each with a forced one"); the issue, its epic #4, its dependency #338 and #328 (Needs you) and #329 (the
sidebar). At the base: `crates/deep-replica` (README, `src/lib.rs`, `src/replica.rs`, `src/shell.rs`, `src/snapshot.rs`,
`src/live.rs`, `src/deep_drive.rs`, `src/drive/mod.rs`, `motion.rs`, `plant.rs`, `Cargo.toml`), `crates/deep-app` (README,
`src/views.rs`, `src/record.rs`, `src/bound.rs`, `src/states.rs`, `src/events.rs`, `src/main.rs`'s record loop, `src/plain.rs`'s
`planted`, `Cargo.toml`), `vendor/gpui-pre/src/window.rs` (the `on_request_frame` path: it draws when `invalidator.is_dirty() ||
force_render`) and `src/app/headless_app_context/present_frame.rs` (the carried patch that delivers a request with
`force_render: true`), `vendor/gpui-pre-apple/upstream/README.md`, `packages/hub/src/status.ts` (the core's quiet reading),
`docs/spikes/338/fixtures/`, and the suites `tests/acceptance/1427/` and `124/` as the model. #124's helpers (the `deep-drive`
build, `Drive`, cleanup by PID) and #26's (a real hub with an agent stand-in) are reused by import.

## Run them

```sh
npm ci                                          # once
npx tsc -p tests/acceptance/1546/tsconfig.json
npx vitest run --root tests/acceptance/1546 --no-file-parallelism
# by hand only, on a Mac with a display, never in CI (needs `npm run build --workspaces` and `cargo build -p deep-hook`):
DEEP_LIVE_1546=1 npx vitest run --root tests/acceptance/1546 ac4-needs-you.live.test.ts
```

`cargo` must be on `PATH`. Each file builds `deep-drive` once with `cargo build --locked -p deep-replica --bin deep-drive
--features env-plants` (#124's helper); the live file builds `deep-live` the same way. macOS only: off macOS every test fails
`INCONCLUSIVE:` and never passes; a binary that can't be built, or a hub that doesn't start, fails `BLOCKED:`. Temp folders are
`/tmp/dd124-*` and `/tmp/dh26-*`; every process is stopped by its PID.

## The surface, and why it is the smallest real one

The criteria are about frames a window draws on its own, so they can only be judged where GPUI decides whether to draw: in a
real GPUI window. The replica's driver `deep-drive` (#124) is the base's one process that steps a headless app window on the
virtual clock through record events, hovers and clock steps, and #1427 already added a mode-like call to it. So this job adds
one launch field, two calls and one reply field to `deep-drive`, and one flag to `deep-live`; no new binary, package or
`[[test]]`. A unit test of a view's `render` would pass a view that never notifies (the base's bug); a forced-frame snapshot
(the base's `render_frame`, which refreshes first) would pass it too, because it redraws every view. Only a window that draws
when GPUI says it is dirty sees a missing notify.

### `launch.frames: "every" | "dirty"`

`"every"` (the default) is the base's replica: each frame of its clock refreshes the window and draws every view. With
`"dirty"` the launch reply carries `"frames": "dirty"`, and for that replica:

- Each frame of its clock (1/60 s; #124's `tick`) advances GPUI's clock, runs until parked, and then delivers one frame request
  through GPUI's own frame path (the test window's `on_request_frame` callback, as `present_frame` does) with
  `force_render: false`, so GPUI draws only when its invalidator says the window is dirty. The replica never calls
  `refresh` or `render_frame` itself in this mode, not after an input either.
- The views' clock is the virtual one: the launch's now (`NOW`, 1,800,000,000,000 ms, for a fixture) plus `t` (flicks since
  launch; `t / 705,600` ms). At the base, `deep-drive` sets it once at launch and never moves it.
- `see`, `expect`, `wait_for` and the waits inside `act` read the last frame GPUI drew on a request. They draw nothing.
- After each step (every call after `launch`, numbered from 1 as `close`'s `journey.steps` names them, "step N: call";
  `close` is no step), the replica compares the `see` snapshot of the last drawn frame with the snapshot of a forced frame
  (`refresh`, then a draw, as the base draws). The forced frame is the check's own: it never becomes the frame `see` reads, so
  a view a real window would show stale stays stale in the replica until GPUI next draws.

### Two calls, for a launched replica in either mode

- `{"call": "feed", "feed": {"session": "<id>", "event": {v, id, kind, writer, actor, scope, subject?, data}}}` delivers one
  record event to the replica's own record (never yours) at the next `log_pos`, with `ts` the views' clock now and `session`
  given, through the app's one record reader as the hub's stream would, and nothing else: the replica marks nothing dirty.
  Then one frame of the clock passes. Reply: `{"ok": true, "t", "log_pos", "ts"}`.
- `{"call": "resize", "resize": {"size": [w, h]}}` sets the window's content size in points; then one frame of the clock
  passes. Reply: `{"ok": true, "t", "window": {"size": [w, h], "scale"}}`.

### `close`'s `frames` report (mode `"dirty"` only)

```jsonc
"frames": {
  "claim": "PASS" | "FAIL" | "INCONCLUSIVE",
  "clean": n,                    // steps with frames > 0 and drawn == 0
  "steps": [{"step": 1, "call": "feed", "t": flicks, "frames": n, "drawn": n, "equal": bool}],
  "findings": [{"step": 1, "call": "feed", "view": "deepbuild/needs-you",
                "node": {"role", "name", "value", "bounds"},     // as the forced frame has it
                "drawn": {"role", "name", "value", "bounds"} | null}]
}
```

- `frames`: frames of the clock that passed during the step; `drawn`: frames GPUI drew on request during it (the comparison's
  forced frame not counted); `equal`: the two snapshots after the step are equal.
- One finding per step and view whose nodes differ: `node` is that view's first node, in tree order, at which the forced
  frame differs from the drawn one, as the forced frame has it; `drawn` is the drawn frame's node at that place, or null.
  `view` is the registered name of the shipped view that draws the node (`views.rs`: `deepbuild/needs-you`,
  `deepbuild/sidebar`, ...), whatever slot it sits in; the tests match its last segment.
- `claim`: FAIL with any finding; else INCONCLUSIVE when no step is clean (every step that passed a frame drew one, so a view
  that missed its notify would have been redrawn anyway; a step that passes no frame, like `see`, is neither); else PASS.

### `deep-live --view needs-you --out <file> --watch`

The real app window, shown, at the reference window, on the record of the hub at `$HOME/.deepbuild`, read through the app's
own record reader and its tick (`crates/deep-app/src/main.rs`, `notifications`), never the fixture. It sends the window no
input and forces no frame. `<file>` gets JSON lines: once the reader has reached the hub and the first frame is drawn,
`{"ready": true, "at": ms}`; then one line per frame the window draws: `{"frame": n, "at": <ms since the epoch on this Mac's
clock, when it drew>, "log_pos": n, "names": [every accessibility name under Needs you, in tree order]}`. It runs until
stopped (SIGTERM). At the base `--watch` is an unknown argument.

## The planted programs

Each is read only in a build with the `env-plants` feature, which a release build refuses (#1408); the implementer adds them.

| Plant | Selected by | The wrong program |
|---|---|---|
| `record-in-thread-local` | `DEEP_HUB_PLANT` (deep-app, `plain::planted`) | The app's views read the record from the reader's thread-local in render and observe nothing; a record event marks nothing dirty and refreshes no window, as at the base. |
| `no-age-timer` | `DEEP_HUB_PLANT` | An age a view shows sets no next tick: the timer removed. Everything else, the views' clock included, is the app's. |
| `notifies-every-step` | `DEEP_DRIVE_PLANT` (`drive/plant.rs`, `Plant::parse`) | Before every frame request, the replica notifies the window's root view, so every frame GPUI is asked for draws. |

At the base the two `DEEP_HUB_PLANT` names select nothing (the app compares names it knows), and `DEEP_DRIVE_PLANT=
notifies-every-step` is refused (`{"ready": false, "error": "no planted replica notifies-every-step"}`).

## The fixture (`fixtures/quiet.events.jsonl`)

Three sessions on the virtual clock's now `NOW`: `01KBAS5K…` with two open asks (Needs you's two rows), `01KBRD5R…` working,
and `01KBQT5Q…`, gone quiet: its last sign of life is a `tool.after` 90 s before `NOW`, and the core's `session.state
{state: "quiet", cause: "quiet"}` 30 s before `NOW` (a state event is no sign of life, `states.rs`). Its sidebar row reads
"○ Session 01KBQT5Q · quiet · last seen 1 min ago" at launch. The app never decides that a session is quiet: the core does
(`packages/hub/src/status.ts`: attention `unknown`, or no hook for `QUIET_MS`, 24 h), so the fixture carries the core's reading
and the test moves only the clock. The age reads in whole minutes from 60 s (`states::span`), so it reaches 2, 3 and 4 min at
`t` = 30 s, 90 s and 150 s.

## Timing values

- One frame of the replica's clock: 705,600,000 / 60 = 11,760,000 flicks (#124).
- Criterion 2: the row is read 2 frames before and 2 frames after each of the three minutes: "by the next minute" is read as
  "showing the new minute within 2 frames of the moment the age reaches it", across three minutes so the tick must re-arm.
- The seeded journey's clock steps: 1, 2 and 6 frames, 0.5 s, 2 s, 13 s and 41 s.
- Criterion 4: the reader's tick is the app's record loop's 250 ms (`main.rs`, `notifications::TICK`, at the base), and one
  frame is 1/60 s, so each ask must be drawn within 266.7 ms of its `ask.created`'s `ts`. A still window may draw at most 5
  frames in 3 s. A miss with the load average above the core count reads `INCONCLUSIVE:`, never a pass.

## The seeded journey (`helpers.ts`, `journey(seed)`)

mulberry32 from the seed; first an idle probe (0.5 s of the clock, then one frame, which must draw nothing), then 40 steps:
every 13th a new ask; else 30% record events (40% a new ask raised by the core in one of two sessions, 20% one of them
cancelled, 25% a terminal reading, 15% a tool call), 30% clock steps, 20% hovers on the fixture's two Needs you rows, 20% resizes
from 1100x720 to 1598x998 points. Seeds 1546, 7 and 2026 each hold every kind of step. Every 13th step being an ask means
each journey raises at least four.

## The criteria, and what fails each

| Criterion | File | A wrong program it fails |
|---|---|---|
| 1. A seeded journey draws only when dirty, and each step's forced frame equals the last drawn one; a planted view that reads a thread-local with no notify fails, naming the view, the node and the step | `ac1-journey.test.ts` | the base's replica, which draws every frame (the idle probe draws, no clean step); a replica whose `see` reads a forced frame (the planted test's `see` would list the new row); the planted app (findings at the feed step naming `deepbuild/needs-you` with the ask's row, and `deepbuild/sidebar` with "3 asks need you" against "2 asks need you"); a record change that needs input to show (a feed step that draws no frame) |
| 2. A quiet session's row updates by the next minute with no input; a planted app with the timer removed fails, naming the row | `ac2-quiet-row.test.ts` | `no-age-timer` (the drawn row keeps "1 min"; the judge names the row, and the check's finding names it in the sidebar at the clock step that crossed 2 min); a timer that fires once (3 and 4 min); an age read early (the readings 2 frames before each minute); the base's frozen clock |
| 3. A run where every step was dirty reads INCONCLUSIVE, never PASS | `ac3-every-step-dirty.test.ts` | `notifies-every-step` read as PASS; a check that counts a `see` (no frame) as a clean step; the plant together with `record-in-thread-local` read as PASS |
| 4. Against a real hub, an `ask.created` changes Needs you in `deep-live` with no input, within the reader's tick plus one frame | `ac4-needs-you.live.test.ts` (by hand) | a window that shows the ask only after input (never drawn); a slower reader (over 266.7 ms); a window redrawn every frame to meet the time (over 5 idle frames in 3 s) |

Each test fails at the base because the surface is missing (BASE-FAILURE.txt).

## What the implementer adds outside this folder

- `crates/deep-replica/src/drive/`: `launch.frames`, `feed`, `resize`, the comparison and `close`'s `frames`; the plant
  `notifies-every-step` in `plant.rs`. If GPUI's frame request with no forced render needs a carried patch beside
  `present_frame`, it goes in `vendor/gpui-pre` with its row in `vendor/gpui-pre-apple/upstream/README.md`.
- `crates/deep-app`: the plants `record-in-thread-local` and `no-age-timer` under `env-plants`.
- `crates/deep-replica/src/live.rs`: `--watch`.
- `scripts/lanes.mjs`: `alone.push('tests/acceptance/1546/')` (the files build `deep-drive` and start replicas);
  `byHand.push('tests/acceptance/1546/ac4-needs-you.live.test.ts')` and `timed.push(` the same `)` (its verdict reads the load).
- No `Cargo.toml` `[[test]]`: these are vitest files, like #124's and #1427's.

## Ambiguities in the issue this job resolved (each is a place the implementer may disagree; the dispute goes to a blind redraft)

1. **One planted view can't be seen on GPUI as it is.** Any notify marks the whole window dirty and GPUI redraws every view (no
   cached views here, which the issue leaves out of scope), so a single view that reads the record unobserved, beside views that
   observe the same change, is redrawn with them and no frame comparison can see it; the issue says as much ("a notify on the
   root holds only on the first"). The plant therefore takes the record off the observed path for every view that draws it, as
   at the base, and the tests require a finding for each view the fed ask changes: Needs you (the row) and the sidebar (the count).
2. **"Naming the node"** is fixed as each view's first differing node in tree order, as the forced frame has it, with the drawn
   one beside it. **"The step"** is the replica's own step number, the one `close`'s `journey.steps` uses.
3. **The forced frame is not a drawn frame.** "Draws only the frames a real window would" means the comparison's forced frame
   never becomes what `see` reads; so a stale view stays stale and findings may repeat on the steps after; the tests require
   only the first one, at the record event.
4. **"By the next minute"**: within 2 frames of the minute the age reaches, checked at three minutes in a row.
5. **"Going quiet"**: the app reads quiet from the core; the fixture holds the core's reading and the clock moves the age.
   Whether the core decides quiet at the right time is not this issue's.
6. **"Every step was dirty"**: steps that pass no frame of the clock are neither dirty nor clean; PASS needs one clean step.
   A run with only such steps reads INCONCLUSIVE (not tested separately).
7. **The planted notify** is the replica's (`DEEP_DRIVE_PLANT`), before every frame request: a step is the replica's notion.
8. **"The reader's tick"** is pinned to the base's 250 ms; an implementation that changes the app's tick changes this
   criterion's bound, which is a dispute, not an edit. "One frame" is a 60 Hz frame.
9. **`deep-live` against a real hub** needed a mode: the base's `deep-live` draws the fixture and quits after 8 forced frames.
   `--watch` is the smallest change to it; its frame lines are what the test reads, so the window is judged as it drew.
10. **The sidebar may change under #329** (quiet sessions folded into one line per repo, new row names). The tests find the
    quiet row as the one button that reads "quiet" and "last seen", and match views by the last segment of their names.

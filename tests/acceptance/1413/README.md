# Acceptance tests for #1413: GPU allocation failures reach a writer, and device errors print with a limit

Written first, from issue #1413 ("GPU allocation failures never reach a writer, and device errors print without
limit": its Scope, thirteen acceptance criteria, Proof and Not in scope), the design sections it touches and the base
commit `063e410a` ("Merge pull request #1684 …", main at the time, which holds `da22dbe4`), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Writer connection, Frame callback and presentation feedback, GPU surface (slots
  `free | rendering | ready | on_screen`, "with no free slot, the frame is skipped", "Resizes allocate lazily", "A
  command buffer that failed never counts as a finished frame … repeated failures take the reopen path"), Render
  worker, Window and display placement, Meter and degrade ladder (the ladder ends at `placeholder`; "Each rung records
  why it holds"; "tells that writer why at every rung"), Liveness and recovery (the paragraph this issue lands: an
  allocation failing while a writer's resources build, "never inside a frame", returns `out_of_memory` naming the
  writer and its view takes the placeholder rung; device errors logged with a burst limit and a count of those
  suppressed; three reopen attempts off the UI thread at 1, 2 and 4 s, then the placeholder rung with the reason, 2D
  layers to the CPU picture, a GPU change tries again; a failed resize frees its slot and tries again next frame).
- `docs/technical-design.md`: How we know version 0 works (wrong programs, planted twins, the blank guard), Tests
  written first, Dogfooding; and issue #157's `film.blank` and flat-frame guard (the "#157 blank guard").
- Code at the base: `crates/deep-gpu/src/device.rs` (`on_uncaptured_error` prints every error with `eprintln!` and
  pushes it on a list; `force_loss`; `Gpu::recover` reopens at once, unbounded), `meter.rs` (`Rung::Placeholder`, the
  ladder's reasons), `view.rs` (`render` → `reallocate(slot)?` after `begin`, with no `abandon` on its error;
  `rebuilds`), `surface.rs`, `memory.rs`; `crates/deep-gpu-layer/src/main.rs` (calls, `--planted`, features
  `test-meter`, `test-seam`, `test-spike`), `live.rs` (the `live` call: events, `take_raised` after submit, `errors`
  report, `told`, `changes`, `capture` → each view's `final` PNG), `frames.rs` (the `frames` call, `lose_device_at`,
  window captures, the question card), `effects.rs` and `deep-scene3d-render/src/op.rs` (error scopes filter
  `Validation` only), `deep-canvas-test-modules` (`test.gpu`'s kinds).
- Suites: `tests/acceptance/377/` (the `frames`, `surface` and `resources` calls, the scene fixture, the card test,
  device loss, PNG reading), `379/` (the `live` call, the stub meter, `test-meter`, planted programs, INCONCLUSIVE off
  Metal), `385/`, `425/` (live `capture` and `final`), `308/` (README and helpers style).

What the base already does and these tests don't credit: one device per app, rebuilt after a forced loss (#377); the
`live` and `frames` calls; the ladder's `placeholder` rung. Missing: an out-of-memory scope, a writer told about a
failed build, a limit on printed errors, a bounded reopen, a freed slot after a failed resize, and every test hook
below. So every test fails at the base (`BASE-FAILURE.txt`).

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1413 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1413/tsconfig.json   # type-check
```

Each file builds `cargo build --locked --bin deep-gpu --features test-faults` once (with `CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0` unless you set them), copies the binary out of `target/debug` into a temporary folder,
and fails each test if the build failed. The files share that one build and run real-time live windows (up to about
13 s each), so they run one at a time: `scripts/lanes.mjs` needs `tests/acceptance/1413/` in its `alone` list,
beside `377/` and `379/`. This README is the instruction; the implementer makes that edit.

Every test reads a real device. Off macOS they fail with a message that starts `INCONCLUSIVE:`, as does any reply
`unsupported_platform`; they never pass there. No test is gated on load or power. The reopen clock is real time at
the issue's numbers (no virtualized timing knob): the live call already paces its frames at `fps`, so frame k is
shown no sooner than (k − 1) ÷ 60 s after the first. A run leaves Vitest's cache in
`tests/acceptance/1413/node_modules/.vite`; delete it.

## The surface under test

The issue names no code API. **Every name below that the issue or design doesn't give is this job's choice**, the
smallest one consistent with the design and the base protocols; the implementer builds exactly these, or a dispute
goes to a blind redraft. Everything is `deep-gpu run`'s existing JSON-lines protocol (#377): one scenario
`{"out": dir, "calls": [Call]}` on stdin, one line `{"ok": true, "replies": [Reply]}` out, exit 0.

### Builds and startup

- **Feature `test-faults`** of `deep-gpu-layer` (new): everything below marked *test-faults*. It enables `test-meter`
  too (#379's stub meter and the test canvas module `test.gpu`, which holds the two new test kinds). No shipped build
  has it. Every file builds this one set.
- **`deep-gpu run --fail-reopen <n | always>`** (*test-faults*): the planted reopen. Each reopen of a lost device
  fails, as if no device came back, for its first `n` attempts in the process, or for every attempt with `always`;
  after `n` the failure has cleared and the next attempt opens a device as usual.
- **`--planted <name>`** takes three new wrong programs (Planted programs, below).

### The `live` call (#379's), additions

Events (*test-faults*), beside #379's `open`, `close`, `revise`, `rung`, …:

- `{"frame": n, "lose_device": {"during"?: label}}`: without `during`, the app's device is lost at once
  (`Device::force_loss`), at that point in the frame's events. With `during`, the loss is armed: the device is lost
  just as the next build of the resource labeled `label` starts (a later event of the same frame, such as a `revise`
  whose revision holds it, builds it), so that build runs on the lost device.
- `{"frame": n, "gpu_change": {}}`: the platform's GPU-change notification arrives (a GPU or driver change); the
  app tries to reopen the device again if it gave up.

Reply fields (every `live` reply, in any build):

- `writer_errors: [{frame, session, writer, code, label, bytes, later_validation, appended}]`: each error a writer
  is told, once per failure, in order. `code` is the cause: `out_of_memory`, `device_lost`, `validation` or
  `internal`. `label` and `bytes` are the failed resource's label and requested size (`null` where none applies:
  a pipeline has a label and no bytes). `later_validation` counts the validation errors that resource caused after
  it failed, which are never the cause. `appended` lists later errors added to it, each `{code, …}` (a device loss
  after it). `frame` is the frame whose build failed. `writer` is the session's writer, as `views[].writer` names it.
- `reopens: [{frame, ms, ok, thread}]`: each attempt to reopen a lost device, in order: the frame during which it
  ended, the wall-clock ms from the loss it follows to its start, whether it opened a device, and the name of the
  thread it ran on (the UI thread is `main`, #379's `ui_thread`).
- `device_losses`: how many times the device was lost during the call.
- With `report` holding `errors` (#420's), each frame row also has `error_scopes`: how many wgpu error scopes were
  pushed on the render thread from the start of that frame to its end, its events and latches (builds) included.
  Scopes pushed on other threads (the compile thread's off-screen compiles) don't count.

Rungs and reasons: a view that can't draw its revision takes the existing `placeholder` rung (`views[].rung`). A
placeholder taken because the device won't come back records a `changes` row `{to: "placeholder", reason:
"device_lost"}` and a `told` row to its writer with the same rung and reason (`device_lost` is a new reason beside
#379's five). With `capture` listing a frame, a view at the placeholder rung has `final`: a PNG of the picture the
window shows in the view's place, as presented, written as `<sha256>.png` under `out` (a lost device can't read a
slot back, so the placeholder is the CPU-drawn picture, never a missing file).

### The test kinds (`test.gpu`, *test-faults*)

- `test.alloc@1 {label: string, bytes: integer, uses: integer = 0}`: as its revision latches (a build, never inside
  a frame), one GPU buffer labeled `label` of `bytes` bytes is asked of the device, then used `uses` times (each use
  a device operation that reads or writes it; on a buffer that failed each raises one validation error). The tests
  ask for `2 × os.totalmem()` bytes ("a build over the device's memory": twice the Mac's unified memory, which its
  GPU shares) and for 1 MiB and 2 MiB ("within memory"). The over-memory buffer must be refused by the device itself
  and reported as out-of-memory; how its size reaches the device (wgpu refuses a size past `max_buffer_size` as a
  validation error before the device sees it; `memory::buffer` shows a raw Metal route) is the implementer's choice.
- `test.pipeline@1 {label: string}`: as its revision latches, one render pipeline labeled `label` is built.

Both are checked like `test.gpu`'s other kinds: a document that holds one lists `test.gpu: ^1` in
`requires.modules`, and the check passes it with no issue (the check never estimates these buffers).

### The `frames` and `surface` calls (#377's), additions

- `frames` takes `fail_resize: n` (*test-faults*): the planted allocator fails the next `n` allocations of a slot's
  storage at a size other than that slot's previous one (a slot's first allocation isn't a resize and never fails).
- Each `frames` reply frame has `drawn: bool` (whether the GPU-layer view drew this frame into a slot; `false` with no
  view, `layer: false`) and `shown_frame: n | null` (the frame whose slot the view shows after this frame; `null`
  with no view). A frame whose render failed is still presented: `drawn: false`, `pixel_hash: null`.
- `surface`'s reply has `rebuilds`: the current view's `View::rebuilds()`, the device-loss rebuilds.

### `raise_errors` (*test-faults*)

`{"call": "raise_errors", "count": n}` raises `n` identical validation errors on the app's real device, through its
uncaptured-error callback, as fast as it can. Reply `{"raised": n, "ms": elapsed, "burst": b}`: how many errors the
callback received during the call, the call's wall time, and the print limiter's burst.

### stderr

The device's error print keeps the base's prefix: each printed error starts a line with `deep-gpu: the device
raised`. Errors past the burst are counted, and the count is printed as one line that starts `deep-gpu: `, holds the
word `suppressed` and exactly one number, the count, and doesn't start with the error prefix. That line is printed
by the time the process exits at the latest.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `keeps_latest_error` | The error reporter keeps the latest device error as the writer's cause, as the base's list in arrival order does | #1413.45bacca1 |
| `reopens_tight_loop` | A lost device is reopened once a frame, with no backoff and no cap | #1413.b3581ccc |
| `resize_leaves_rendering` | The merge base's resize: `render` returns from `reallocate` with no `abandon`, so the slot stays `rendering` | #1413.52a90d72 |

## Fixtures

`fixtures/look.json` is #379's acceptance look. `fixtures/surface-handoff.scene` is #377's scene (copied, so this
suite doesn't read another's folder): 1936 × 1584 in a 2000 × 1648 window, and with `resize` on its size changes
every 50 frames (frame 50: 1452 × 1188). The live documents are generated in `helpers.ts` (`sceneDoc`): a 320 × 240
figure-class scene, a camera and four boxes, one sliding over the 60 s span so every frame differs. Every `live`
call stubs each writer's charge at 0.75 ms GPU and 3 ms CPU (#379's `stub_meter`): under the figure class's limits
and without headroom, so no rung moves for frame health or climbs and a view's pixels don't depend on the machine's
load.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text (trimmed, whitespace collapsed, the leading `- [ ] `
dropped). Each test's name starts with its ID.

| ID | Criterion | Test, what it asserts, and the wrong program it fails |
|---|---|---|
| `#1413.80fd1f16` | A build over the device's memory, forced in a test, returns `out_of_memory` naming the writer; other views keep drawing | `oom.test.ts`: alpha and bravo draw; alpha's revision at frame 30 holds a buffer of twice the Mac's memory. Alpha's writer is told exactly one error, `out_of_memory`, `writer` agent:alpha, frame 30; no other writer is told one; bravo draws all 90 frames at base with 90 distinct hashes. Fails: the base (frame goes on, nobody told); a failure that stops the frame or another view |
| `#1413.8ccae236` | That view draws `Placeholder` on the next frame, and the document's check result doesn't change | `oom.test.ts`: alpha at base before 30, at `placeholder` on 31 and every frame after; the session stays `live`, revision 2 isn't `refused` and has no issue, and no `out_of_memory` issue enters the session. Fails: drawing a resource that doesn't exist; an OOM turned into a check refusal |
| `#1413.14667826` | 1,000 identical device errors in a second print at most the burst, then one line with the suppressed count | `burst.test.ts`: `raise_errors` 1,000: all 1,000 reach the callback within 1 s; the reported burst is 1..100; printed error lines are ≥ 1 and ≤ the burst; exactly one suppressed line whose one number is 1,000 minus those printed. Fails: the base's print of every error |
| `#1413.8d4c0949` | A build within memory opens no extra error scope per frame | `scopes.test.ts`: builds of 1 MiB and 2 MiB at frames 1 and 30, 60 frames with `report: errors`: no writer error, alpha at base throughout, frames 1 and 30 each push ≥ 1 scope (around the build), every other frame 0. Fails: a scope around every frame; no scope around the build |
| `#1413.dc5f17ae` | With a planted reopen that always fails, each affected view shows a non-blank placeholder within 2 s, passing #157's blank guard | `reopen.test.ts` (`--fail-reopen always`, loss at frame 30, 12 s on, a capture every 6th frame): one loss, exactly three reopens, all failed; alpha and bravo each have one change to `placeholder` with reason `device_lost`, and their writers are told it; each shows a captured placeholder that passes #157's guard (not blank: luma ≤ 0.06 over ≥ 98%; not flat: ≥ 98% in one 3-code luma window) within 120 frames (2 s) of the third failed reopen, and every capture after it does too. Fails: a blank or flat placeholder, none, or one later than 2 s |
| `#1413.b3581ccc` | At most 3 reopens happen in 10 s. A planted tight loop fails, naming the count | `reopen.test.ts`: in the same run at most 3 reopens within 10 s of the loss, none on the UI thread. `--planted reopens_tight_loop` over 11 s: the check fails and its first sentence names a count above 3 |
| `#1413.1e112492` | Windows with no GPU view keep drawing, and the question card stays usable | `reopen.test.ts`: after that run, in the same app with the device lost for good, a `frames` call with no GPU-layer view and the question card presents frames 0–2, each window equal pixel for pixel to the same call on a healthy device (a fresh process) and passing the blank guard. Fails: a window that waits on the lost device or loses the card |
| `#1413.acbc8cc2` | When the planted failure clears, the view returns from documents, with step hashes equal to an unbroken run | `recover.test.ts` (`--fail-reopen 3`): loss at 30, three failed reopens, `placeholder` at frame 599, a GPU change at 600 whose reopen succeeds; the view returns at base, and each of at least 60 settled frames after its return hashes as the unbroken run's same frame (a fresh process, 720 frames), each a new picture. Fails: a view that stays a placeholder, or returns from stale state or the wrong time. "Step hashes" read as the view's per-frame pixel hashes (`report: hashes`) |
| `#1413.52a90d72` | A planted allocator failing a resize leaves the slot Free, keeps the last frame shown and reads `rebuilds` 0. The merge base leaves it Rendering and fails | `resize.test.ts`: `fail_resize: 1` over frames 0–50: all presented, 0–49 drawn, 50 `drawn: false` with `shown_frame` 49, no loss, then `surface`: no slot `rendering`, `rebuilds` 0. `--planted resize_leaves_rendering`: the check names a slot left rendering |
| `#1413.4cf20a59` | Ten failures in a row leave the view able to draw when the failure clears, at the new size, with one retry a frame at most | `resize.test.ts`: `fail_resize: 10` over frames 0–60: frames 50–59 each `drawn: false`, `shown_frame` 49; frame 60 drawn at 1452 × 1188 with the pixel hash of a fresh start's frame 60; no loss, no slot rendering, `rebuilds` 0. Ten failures spent on exactly frames 50–59 is one retry a frame: two a frame would draw by 55, none would leave 60 failing |
| `#1413.667c4a0a` | A failed allocation on a lost device still takes the reopen path | `loss.test.ts`: the device lost as a 1 MiB buffer of alpha's next revision starts to build (`during`), no planted reopen: one loss, the first reopen succeeds, no `out_of_memory` told, no placeholder change, alpha at base with hashes in the last 60 of 240 frames, revision 2 `current`. Fails: the loss's symptom read as out-of-memory |
| `#1413.45bacca1` | A forced out-of-memory on a labeled buffer, then 50 validation errors that use it: the writer's error is `out_of_memory` naming the label and the bytes, with 50 later errors counted. A planted reporter that keeps the latest error returns `validation` and fails | `cause.test.ts`: alpha's revision holds `oom-buffer`, twice the Mac's memory, used 50 times: one error for alpha, `out_of_memory`, label `oom-buffer`, `bytes` the requested size, `later_validation` 50. `--planted keeps_latest_error`: one error, `validation`, and the check fails it naming that |
| `#1413.da13fc6f` | A forced device loss during a labeled pipeline build names that pipeline | `loss.test.ts`: the device lost as `probe-pipeline` (`test.pipeline@1`) starts to build: alpha's writer is told exactly `{device_lost, label probe-pipeline}` |

## Readings where the issue leaves a choice

- "Within 2 s" (#1413.dc5f17ae) is measured from the third failed reopen, the bounded end the scope bullet sets
  before "Then GPU-layer views take the Placeholder rung", in frames of the live clock (120 at 60 fps).
- "At 1, 2 and 4 s" isn't pinned beyond the criterion's bound: at most 3 attempts in 10 s and exactly 3 in all
  before the placeholder; 1, 2, 4 s from the loss or as gaps both pass.
- "The burst" has no number in the issue or the design. The limiter reports it, and this job caps it at 100 lines:
  a burst that lets most of 1,000 lines through limits nothing.
- "Usable" for the question card is read as drawn in its slot exactly as on a healthy device, frame after frame;
  the `frames` call has no answer path, and the card's answer path doesn't touch the GPU device.
- The scope's 2D-layer fallback (Vello GPU to GPUI or Vello CPU) has no criterion and no test here.

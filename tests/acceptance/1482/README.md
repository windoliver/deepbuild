# Acceptance tests for #1482: a hover frame has a budget, and a frame that changes nothing is caught

Written first and blind, from issue #1482 (its problem, Scope, thirteen acceptance criteria, Proof, Not in scope and
Depends on), the design and the base commit `80561d40c` ("Merge pull request #2726 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- `AGENTS.md`; `docs/technical-design.md`: Numbers version 0 has to hold (the Chrome frames row; Every task carries its
  own budgets; The reference Macs), How we know version 0 works (Wrong programs: "a planted wrong program lives in test
  code, or behind a build feature a release build refuses to compile"; Criteria to tests; Tests written first;
  Dogfooding); `docs/canvas-primitives.md`: The cost model, Frame clock and scheduler, Invalidation and damage.
- The issue's dependencies #1426 (the carried-patch table) and #1546 (frames drawn only when GPUI says the window is
  dirty), through their suites and the base.
- At the base: `crates/deep-replica` (README, `Cargo.toml`, `src/deep_drive.rs`, `src/drive/mod.rs`, `frames.rs`,
  `plant.rs`, `locate.rs`, `src/snapshot.rs`, `src/shell.rs`), `crates/deep-app` (`Cargo.toml`, `src/views.rs`'s
  `Shipped::render` and its `Kind::Sidebar` branch and `list_row`, `src/list.rs`, `src/record.rs`, `src/bound.rs`,
  `src/states.rs`, `src/open.rs`, `src/words.rs`, `src/events.rs`, `src/plain.rs`, `src/chrome.rs`), the clean look's
  sizes, `vendor/gpui-pre` (`App::notify`, `WindowInvalidator`, `Window::dispatch_event`, `src/view.rs`'s
  `prepaint_view` and `paint_view`, `src/elements/div.rs`'s hover, tooltip and scroll listeners, `uniform_list.rs`,
  `list.rs`'s `scroll`, `src/profiler.rs`, `src/window/a11y.rs`, `headless_app_context.rs` and `request_frame.rs`),
  gpui-kit's `open_window`, `Root` and `TestWindowExt::render_frame` at the pinned revision,
  `vendor/gpui-pre-apple/upstream/README.md`, `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`),
  `scripts/lanes.mjs`, `scripts/throttle.mjs`; the suites `tests/acceptance/1546/`, `124/` (whose helpers this suite
  imports), `1477/`, `854/`, `2117/`, `1434/`, `1015/`, `1461/`, `2021/`.

## Run them

```sh
npm ci && npm run build --workspaces            # once
node node_modules/typescript/bin/tsc -p tests/acceptance/1482/tsconfig.json
npx vitest run --root tests/acceptance/1482 --no-file-parallelism --testTimeout=600000
```

- **Builds.** `hover`, `counts`, `wheel` and `access` use #124's debug build with the planted programs, `cargo build
  --locked -p deep-replica --bin deep-drive --features env-plants` (`target/debug/deep-drive`). `bench` builds the
  release replica once, `cargo build --release --locked -p deep-replica --bin deep-drive --features frame-clocks`, and
  copies it out of the target folder into `$TMPDIR/deep-1482-bin-*` for the file. A binary that can't be built fails
  naming cargo's words. `cargo` must be on `PATH`; `CARGO_TARGET_DIR` is honored for the release binary.
- **Machine.** macOS only (the replica renders with GPUI's offscreen Metal renderer); elsewhere each test fails
  `INCONCLUSIVE:` and never passes. Counts are judged on any Mac, in debug. The two timing criteria are judged by
  `scripts/benchmark.mjs`'s `judgeLimit`: off a reference Mac on mains power with Low Power Mode off, thermal state
  nominal and a load no higher than the core count, they read `INCONCLUSIVE:`, which fails here and never passes.
- **Processes and folders.** Temp homes are #124's `/tmp/dd124-*`; every process is stopped by its PID.
- **Time.** `hover` runs seven 200-move journeys, `counts` twenty short ones and three 200-move ones, `access` three
  replicas, `wheel` four; `bench` six runs of three arms after its build. A run leaves Vitest's cache in
  `tests/acceptance/1482/node_modules/.vite`; delete it.
- **Lanes.** These files build `deep-drive` and start replicas, and `bench` times them: `scripts/lanes.mjs` needs
  `alone.push('tests/acceptance/1482/')` and `timed.push('tests/acceptance/1482/bench.test.ts')`. The implementer
  makes that edit.

## The surface under test, and why it is the smallest real one

The criteria are about frames a window draws, the views each one renders and the entity each notify names, so they can
only be judged where GPUI decides what to draw: in a GPUI window that draws only when it is dirty. The base's one such
harness is `deep-drive` in #1546's mode (`launch.frames: "dirty"`). The issue says the read-back lives "in the harness
only, never the app", the journey is a "release replica journey", and the bench builds with gpui-kit's `profiler`
feature, so this suite extends `deep-drive`: three launch fields, two act forms, two calls and fields in `close`'s
frames report, a cargo feature for the clocks, and planted programs. No new binary or `[[test]]`. A unit test of a
view would see neither the notifies GPUI routes nor the views it rebuilds; the profiler's own view timing drops views
under 500 µs; only the window's own frame path sees both.

**Every name below is this job's choice**; the issue names none. The implementer builds exactly these.

### Builds

- The debug build with `env-plants` (#124's), as above: every planted program below is read only there; a release
  build refuses `env-plants` (#1408).
- A new deep-replica feature, **`frame-clocks`**, which turns on gpui-kit's `profiler` (`gpui-kit/profiler`) and the
  per-frame clocks (`cpu_ms`, `gpu_ms`, `allocations`, below). In no shipped build; a release build allows it, as
  `test-renders-unkept-frames` (#184). Without it those three fields are `null`; the counters are always on.

### `launch`, three fields (each needs `frames: "dirty"`; any other value is refused)

| Field | Values | Meaning |
|---|---|---|
| `arm` | `"app"` (default), `"blank"`, `"lists"` | `"app"`: the app's window, as at the base. `"blank"`: an empty window of the same size in the same harness: its root view draws nothing but a background, and the same calls drive it (a pointer move to a point, a refresh). `"lists"`: a window holding GPUI's two list elements side by side, each 1,000 rows 32 pt tall: on the left a `uniform_list` in its own view, named `lists/uniform_list`, the element's id `uniform_list`; on the right a `list` in its own view, named `lists/list`, the element's id `list`; each list element has role `list`, so a locator and `see` find it. Row n (0 to 999) is an element with id `uniform_list:<n>` or `list:<n>`, role `list_item`, name `Row <n>`. |
| `read_back` | `"tiles"` (default), `"off"` | `"tiles"`: each frame GPUI draws on request is read back by the harness (never the app) and compared with the previous frame read back (the first with the launch's frame), in tiles of 64 × 32 device px, the last column and row partial. `"off"`: nothing is read back. |
| `accessibility` | `false` (default), `true` | The window's accessibility is active from launch, as when an assistive client reads it: GPUI builds each drawn frame's accessibility tree. |

The reply echoes `arm`, `read_back` and `accessibility`, beside #1546's `frames: "dirty"`.

### `act`, two forms

- `{"kind": "hover", "point": [x, y]}` with no locator: the pointer moves to `[x, y]` in device pixels, with no wait for
  stillness; then two frames of the clock pass, as after every act. (As `click` with a `point`, #1461.)
- `{"kind": "wheel", "dy": n, "events": k}` with a locator: `k` wheel events, each a precise pixel delta of `dy` points
  (positive scrolls toward the end, as `scroll`'s `dy`), at the target's centre, one each frame of the clock; then two
  frames pass.

### Two calls

- `{"call": "refresh"}`: the window refreshes (`Window::refresh`: every view renders at the next frame); then one frame
  of the clock passes. The frame it draws is a complete frame. Reply: `{"ok": true, "t"}`.
- `{"call": "accessibility"}`: passes no frame. Reply: `{"accessibility": {"active": bool, "focus": id | null,
  "nodes": [Node]}}`: the tree the platform holds after the last frame GPUI drew on request (never #1546's forced
  comparison frame), in tree order (the root first, depth first). `Node = {"id": "<node id>", "role", "name": string |
  null, "value", "bounds": [x, y, w, h] device px | null, "actions": [the actions it has listeners for, sorted],
  "children": [ids]}`. With accessibility inactive: `active: false`, no nodes.

### `close`'s `frames` report (mode `"dirty"`): #1546's fields, unchanged, and these

```jsonc
"frames": {
  "claim", "clean", "steps", "findings",          // #1546's
  "arm": "app" | "blank" | "lists",
  "read_back": "tiles" | "off" | "failed",         // as launched; "failed" once any read-back failed
  "root": "<entity>",                              // the window's root view
  "entities": {"<entity>": {"name": "...", "view": bool, "parent": "<entity>" | null}},
  "list": [Frame, ...],
  "zero_tile_frames": n | null,                    // drawn frames whose tiles changed is 0
  "changed_area": x | null                         // changed tiles over all tiles, summed over the drawn frames
}
Frame = {"frame": n, "step": n, "t": flicks, "drawn": bool,
         "notified": ["<entity>"], "refreshed": bool, "rendered": ["<entity>"], "reused": ["<entity>"],
         "rows": n, "elements": n, "tiles": {"changed": n, "total": n} | null,
         "cpu_ms": x | null, "gpu_ms": x | null, "allocations": n | null}
```

- `list`: every frame since launch, in order: each frame of the replica's clock, drawn or not, and each frame GPUI drew
  as input arrived between them (#1546's input draws: typing, a key, a drag). Not the launch's own frames, nor #1546's
  forced comparison frames, which are the check's and never counted. `frame` numbers them 1, 2, 3 …; `step` is the
  step it passed in, numbered as #1546's (every call after `launch`, from 1; `close` is no step). Per step, the frames
  with `drawn` true are #1546's `drawn`.
- `notified`: every entity `App::notify` was called for since the frame before, in call order, each once, whatever
  made the call: a view, a model, an observer, a timer or the harness's planted program (the carried test-support hunk
  records it). `refreshed`: `Window::refresh` was called since the frame before.
- `rendered`: every view whose `render` ran in the frame, in the order they ran, the window's root included; this is
  what the issue calls views repainted. `reused`: every cached view GPUI reused in the frame instead of rendering it.
- `rows`: the list's rows the frame built (the sidebar's, in the app arm); `elements`: the elements GPUI laid out in
  the frame. An undrawn frame names no view, rows, elements or tiles.
- `tiles` (drawn frames, read-back on): how many 64 × 32 device-px tiles differ from the previous frame read back,
  and how many tiles the window has. `null` when the frame wasn't drawn, the read-back is off, or it failed for that
  frame; a frame not read back is never 0 changed. `zero_tile_frames` and `changed_area` are `null` unless every drawn
  frame has tiles.
- `cpu_ms` (`frame-clocks` only): the CPU time the main thread spent on the frame: dispatching the input delivered
  since the frame before, and the frame's draw (layout, prepaint, paint); not the harness's work (#1546's check, the
  read-back, snapshots, the trace). `gpu_ms`: the GPU time to render a drawn frame. `allocations`: heap allocations
  the frame made. All three `null` without `frame-clocks`.
- `entities`: every entity a frame names. `name` is a shipped view's registered name (`deepbuild/sidebar`,
  `deepbuild/session`, `deepbuild/home`, …, from `views.rs`), the lists arm's `lists/uniform_list` and `lists/list`,
  else the entity's Rust type name. `view`: whether it is a view this window rendered or reused. `parent`: the view it
  was rendered in (its nearest enclosing view), `null` for the root and for entities that aren't views.

### The planted programs

Each is read only in a build with `env-plants`. At the base the six `DEEP_HUB_PLANT` names select nothing (the app
compares names it knows), and each `DEEP_DRIVE_PLANT` name is refused (`{"ready": false, "error": "no planted replica
…"}`).

| Plant | Selected by | The wrong program | Where it must fail, and what the failure names |
|---|---|---|---|
| `hover-notifies-root` | `DEEP_HUB_PLANT` | Each row the pointer enters or leaves also notifies the window's root view. | AC2: `judgeHover` FAILs, a finding naming the root view (`entities[root].name`). |
| `animates-unchanged` | `DEEP_HUB_PLANT` | The sidebar (`deepbuild/sidebar`) requests an animation frame each time it renders and draws the same value each time. | AC3: `judgeHover` FAILs: more than 1% of frames changed no tile, naming `deepbuild/sidebar` as notified in them. |
| `builds-row-out-of-view` | `DEEP_HUB_PLANT` | The list builds one row more than the window shows, the next one, below its bottom edge. | AC11: `rowsOverScreen` names a frame and its count: `built N rows; M are on screen`. |
| `page-redraws-every-session` | `DEEP_HUB_PLANT` | A session's page (`deepbuild/session`) redraws on every record event, whatever its session. | AC9: a view on the page rendered, naming `deepbuild/session`. |
| `setter-skips-compare` | `DEEP_HUB_PLANT` | `open` of the address the window already shows notifies the entity that holds what the window shows, without comparing. | AC12: the setter's step notified an entity, naming it. |
| `page-redraws-with-list` | `DEEP_HUB_PLANT` | The page in the centre redraws whenever the list does. | AC13: a view outside the list rendered, naming `deepbuild/session`. |
| `notifies-root-per-move` | `DEEP_DRIVE_PLANT` | Each pointer move the replica delivers also notifies the window's root view. | AC5: `judgeHover` FAILs naming the root view; the counting reader reads PASS on it. |
| `read-back-fails` | `DEEP_DRIVE_PLANT` | Every read-back fails. | AC4: `read_back: "failed"`, no tiles, and `judgeHover` reads INCONCLUSIVE. |
| `drops-notify-record` | `DEEP_DRIVE_PLANT` | The report names no notified entity: the record of `App::notify` dropped. | AC6: `judgeHover` reads INCONCLUSIVE, naming a frame that names neither a notify nor a refresh. |
| `wheel-notifies-every-event` | `DEEP_DRIVE_PLANT` | The lists arm's two views notify themselves on every wheel event they get. | AC7: more than one frame drawn for the 120 events, naming `lists/uniform_list` or `lists/list`. |
| `reuse-drops-accessibility` | `DEEP_DRIVE_PLANT` | GPUI reuses a cached view as at the merge base: none of its accessibility nodes, action listeners or focus reach the frame. | AC8: the tree differs from the one after a refresh, naming the first node: `<role> "<name>" (node <id>)`. |

## The fixture (`helpers.ts`, `rowsFixture`)

Written at run time into a temp folder: `n` sessions (1,000 or 10,000), `01KB1482` and 18 digits, each the hub's row
for the list (#1463's `row.set`): `{id: "session:<id>", session, listed: true, order, title: "Row 00001" …, project:
"bench", word: "queued", entry: "idle", unread: false, why: ""}`, in one project, with no `since`, so no age on screen
ticks while a journey runs; and the core's `session.state` reading `queued` for session 3, which AC12 writes again.

## The journeys and the judges (`helpers.ts`)

- **The hover journey** (`hoverRun`): launch on the list at `size: [968, 792]`, `scale: 2` (1936 × 1584 device px), read
  the rows wholly on screen from `see`, move the pointer into the list onto the first (a setup step), then 200 moves,
  each onto the next row's centre, down the rows on screen and back up. Those 200 steps are the journey.
- **`judgeHover`**, the one judge of every hover run, shipped or planted, over the journey's frames: a drawn frame naming
  neither a notify nor a refresh, or no view rendered, is INCONCLUSIVE (AC6); a notified view that is neither the list's
  view (`deepbuild/sidebar`) nor inside it, or a refresh, is a finding naming it (AC2, AC5); with any drawn frame
  unread, it is INCONCLUSIVE (AC4); more than 1% of drawn frames with no changed tile is a finding naming the views
  notified in them (AC3). FAIL with any finding, else INCONCLUSIVE with anything unjudged, else PASS.
- **`countsOnly`**, AC5's wrong reader: it fails a frame of the planted run that renders more views than any frame of
  the clean run's same journey, and reads nothing else.
- **The count journeys** (`counts.test.ts`), each a fresh replica on the 1,000-row list, read-back off: open a session
  (a click on row 2); select a row (a click on row 2, then Down); type a word in the box (`open` row 2's page, then type
  `hello` in `box-draft`); an event from an unrelated session (`open` row 2's page, then the hub's row for session 5
  turning `working`); a hub tick with no change (the hub's row for session 3 written again, unchanged).
- **Settling.** After the launch and after each setup step (a click or an `open` before the judged step, the wheel to
  a list's end, the click that gives the list its focus), half a second of the clock passes with nothing done
  (`wait_for`), so what the setup set going is not counted in the step a criterion judges.

## Criteria to tests

| Criterion | Test | A wrong program it fails on |
|---|---|---|
| AC1 hovering 200 rows at 1936 × 1584: CPU per frame under 2 ms at p95, under 25% of a complete frame's, compared with the merge base at the lane's margin | `bench.test.ts` AC1: release `frame-clocks` replica, one warm-up run and five runs; per run, p95 of `cpu_ms` over every frame of the clock in the 200 hover steps (400, at least 300) and the median of 30 complete frames (`refresh`); `judgeLimit` on the five p95s against 2 ms and on the five ratios against 0.25; the blank arm's numbers printed beside | the base (no `frame-clocks`); an app whose hover frame is a complete frame (ratio near 1) |
| AC2 a planted `notify` at the window root fails, naming the view | `hover.test.ts`: the shipped run reads PASS; `hover-notifies-root` FAILs naming the root view | `hover-notifies-root` |
| AC3 at most 1% of frames in the journey have zero changed tiles; a planted animation of an unchanged value fails, naming the view | `hover.test.ts`: the shipped run's tiles are 64 × 32 (1,550 for the window), its zero-tile frames at most 1%; `animates-unchanged` FAILs naming `deepbuild/sidebar` | `animates-unchanged` |
| AC4 a run with the read-back off or failing reads INCONCLUSIVE, never PASS | `hover.test.ts`: `read_back: "off"` and `read-back-fails` each report no tiles and read INCONCLUSIVE | a report that counts an unread frame as unchanged, or a judge that passes it |
| AC5 a planted extra `notify` on the window root per pointer move fails, naming the notified entity's view; a reader that only counts repainted views passes that plant, and fails its own test | `hover.test.ts`: `notifies-root-per-move` FAILs naming the root view; `countsOnly` reads PASS on the same run, so it fails what AC5 asks of a reader | `notifies-root-per-move`; the counting reader |
| AC6 each frame's report names every notified view and the views rendered; a frame with neither a notify nor a refresh named reads INCONCLUSIVE | `hover.test.ts`: in the shipped run each drawn frame names the view whose notify drew it or a refresh; `drops-notify-record` reads INCONCLUSIVE | `drops-notify-record` |
| AC7 120 wheel events at the end of a `uniform_list` and of a `list` repaint 0 views and draw at most 1 frame; a planted notify on every event fails, naming the view; a wheel 1 px from the end moves exactly 1 px, then nothing | `wheel.test.ts`: per list, wheel to the end, 120 events of 10 pt: no view rendered, at most 1 frame drawn; 1 pt back up, then 12 events: exactly 1 px, one frame drawn; `wheel-notifies-every-event` names `lists/<kind>` | the base's GPUI (a `list` notifies on every scroll; a `uniform_list`'s offset changes before it is clamped); `wheel-notifies-every-event` |
| AC8 if cached views meet the first criterion: with accessibility active, a frame that doesn't redraw a cached view keeps its nodes, action listeners and focus, node for node with a frame after a refresh; GPUI's plain reuse fails, naming the node; with no assistive tech, the view renders 0 times over 100 sibling frames | `access.test.ts`, three tests: the condition, the 100 sibling frames, the tree compared with a refresh's, and `reuse-drops-accessibility` | `reuse-drops-accessibility` |
| AC9 an event from an unrelated session renders 0 views on the page; a planted page that redraws for every session fails, naming the view | `counts.test.ts` | `page-redraws-every-session`; the base, where every view observes the record |
| AC10 three runs of each journey give identical counts | `counts.test.ts`: the five count journeys, three runs each | a counter that reads the clock or the machine |
| AC11 the same hover at 10,000 rows builds the same rows and elements per frame as at 1,000, with CPU per frame within the lane's margin of it; a planted list that builds a row out of view fails, naming the count | `counts.test.ts` (the counts, and `builds-row-out-of-view`) and `bench.test.ts` AC11 (five paired ratios, 10,000 over 1,000, `judgeLimit` against 1.05) | `builds-row-out-of-view`; the base's sidebar, which clones every one of the list's items each frame |
| AC12 a write that equals what's shown, from a hub tick, a reading or a setter, notifies 0 entities and draws 0 frames; a planted setter that notifies without comparing fails, naming the entity | `counts.test.ts` | `setter-skips-compare`; the base, whose `open` refreshes and whose record notifies every view on any event |
| AC13 one row's title changes: the frame builds at most the rows on screen and renders no view outside the list; a planted page that redraws with the list fails, naming the view | `counts.test.ts` | `page-redraws-with-list` |

Every test fails at the base for a missing surface (BASE-FAILURE.txt).

## Ambiguities in the issue this job resolved (each is a place the implementer may disagree; the dispute goes to a blind redraft)

1. **1936 × 1584** is device pixels: the window is 968 × 792 points at scale 2, the size the design's cost figures use.
2. **"Hovering 200 rows"** is 200 pointer moves, each onto the next row on screen, down and back up: the window shows
   about 22 of the 1,000 rows and the list doesn't scroll by wheel yet (#1808). The first move into the list is a
   setup step and isn't judged: entering the list notifies the list's own hover and switches GPUI's input modality,
   which refreshes the window.
3. **"CPU per frame … at p95"** is taken over every frame of the clock in the 200 hover steps, drawn or not (400, at
   least the design's 300 a run): two frames pass per act, one of which draws the hover. Frame CPU is the main
   thread's for the frame's input and draw, never the harness's.
4. **"Compared with the merge base"** (AC1): at the merge base a hover frame is a complete frame (the issue's own
   words), so a complete frame in the change's own build, a `refresh` that renders every view, stands for the merge
   base's hover frame, and "under 25% of a complete frame's" is judged on five per-run ratios at the lane's margin.
   The merge base's replica has no per-frame clock to read, so building it would measure nothing comparable, as
   #1434's suite read its merge base. For the counts the Scope compares with the merge base, the base has no counter:
   its side is missing, the comparison starts with the next change against this one, and no criterion asks this
   suite to make it. AC10 proves what makes that comparison load-proof: three runs give identical counts.
5. **"Views repainted"** is views rendered (`rendered`): a view whose `render` ran.
6. **"A pointer moving over a 1,000-row list repaints only the views it changed"** is judged by what a pointer move
   notifies: only the list's view or views inside it, and never a refresh. A notify at the root rebuilds every
   uncached view, but the root is already dirty in any frame a row is (GPUI marks a dirty view's ancestors), so per-frame
   counts can't see it, and the issue says so; the notify the carried hunk records can.
7. **AC5's "a reader that only counts repainted views"** compares each planted frame's count of views rendered with the
   most any frame of the clean run renders. "Fails its own test": run through what AC5 asks of a reader, a FAIL naming
   the notified entity's view, it doesn't meet it.
8. **AC4's "failing"** read-back is a planted one that fails every frame; the report says `failed` and gives no tiles.
   AC4's and AC6's tests require "never PASS" with the cause named among what the judge leaves unjudged: with nothing
   else found the run reads INCONCLUSIVE; a finding of another criterion's would make it FAIL, which is never PASS too,
   so those tests don't fail for another criterion's finding.
9. **AC6's "names every notified view"**: the report names every entity `App::notify` was called for (models too, with
   `view: false`); a drawn frame of the hover must name the view whose notify drew it, or a refresh.
10. **AC7's "repaint 0 views and draw at most 1 frame"** is read literally: no view renders during the 120 events and at
    most one frame is drawn. GPUI renders at least the window's root on any frame it draws, so both hold together only
    when no frame is drawn or the one drawn renders nothing. The lists arm runs at scale 1, so "1 px" is one point and
    one device pixel. "Moves exactly 1 px, then nothing": the last row ends at the list's bottom edge after the 12
    events, and the step drew exactly one frame.
11. **AC8's condition** is read from the replica, not from anyone's word: cached views meet the first criterion when the
    first of 100 sibling frames (the pointer between two adjacent rows, no assistive tech) reuses a cached view. If it
    reuses none, each AC8 test says so and passes on that measured reading. "The view" is every view that first frame
    reused. "The plain case" is `reuse-drops-accessibility`, a switch back to GPUI's reuse as at the merge base. The
    focus is the list's, on a row clicked first.
12. **AC9's "the page"** is `deepbuild/session` and the views inside it; the views it sits in are not on it. The
    unrelated session's event changes its own row, so the list must draw and the page must not.
13. **AC10's "each journey"** is the Scope's five count journeys, run in debug. "Identical counts": per step, frames
    passed and drawn, and each frame's views rendered, reused and notified by name, its refresh, rows and elements.
    Tiles (read-back off) and clocks (null in debug) are not counts.
14. **AC11's "a row out of view"** is judged against the rows the window shows at all, partly or wholly. "Within the
    lane's margin of it": five paired runs' p95 ratios, 10,000 rows over 1,000, judged by `judgeLimit` against 1.05,
    the lane's 5% margin; the spread of the five widens only its FAIL side.
15. **AC12's three writes**: a hub tick is the hub writing a row it already wrote (`row.set`, the same data), a reading
    is the core's `session.state` reading of the state the record already holds, a setter is `open` of the address the
    window shows.
16. **AC13's "outside the list"** is any view that is neither the list's view, nor in it, nor a view the list sits in:
    GPUI renders those to reach a dirty view inside the list. The centre holds a session's page, opened first.
17. **Not tested, as no criterion reads them**: the record's statements (how the first criterion is met, where the
    list's state lives), which AC8 reads from the replica instead; the rows the carried hunks need in #1426's table,
    which `node scripts/vendor-rebase.mjs check` enforces in the lint lane; limits on GPU time or allocations, which are
    reported columns, checked present in the bench; the blank arm, printed beside AC1's runs.

## What the implementer adds outside this folder

- `crates/deep-replica`: the launch fields, act forms, calls and report fields above; the blank and lists arms; the
  five `DEEP_DRIVE_PLANT` plants in `src/drive/plant.rs`; the `frame-clocks` feature in `Cargo.toml`.
- `crates/deep-app`: the six `DEEP_HUB_PLANT` plants, under `env-plants`.
- `vendor/gpui-pre`: the carried test-support hunk that records the entity at `App::notify` and the views rendered and
  reused per frame, the fix for wheel events at a list's end, and, if cached views meet AC1, the accessibility nodes,
  listeners and focus kept on reuse with the planted switch; each with its row in
  `vendor/gpui-pre-apple/upstream/README.md`, naming a test here.
- `scripts/lanes.mjs`: `alone.push('tests/acceptance/1482/')` and `timed.push('tests/acceptance/1482/bench.test.ts')`.

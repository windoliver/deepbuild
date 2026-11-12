# Acceptance tests for #2117: a bound value in a panel redraws when what it shows changes, not once a second

Written first, from issue #2117 (its problem, Scope, five acceptance criteria, Proof and Not in scope), its parent #4,
the design sections it links and those they lean on, and base commit `4ab2750c` ("Merge pull request #2152 …"), by a
job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Bound value in panels ("updated natively and grayed when stale. Scripts render only when
  structure changes"; never "show a stale number as live"), Panel, Transport ("each frame reports when it next
  changes, so a still canvas costs nothing"), Bound value and status binding, Dogfooding and Built to be hard to get
  wrong (tests first, wrong programs).
- `docs/canvas-primitives.md`: **Bound value** (a value goes stale when the frame's pinned host time passes its as-of
  time plus `stale_after`, "the frame clock arms a frame then, so a still view grays it on time"; "updates coalesce to
  once per frame"; cost "O(1) per bound value per reading change, never per frame"), **Frame clock and scheduler**
  (arms a frame only on "a changed reading … or the host time at which a bound value on screen goes stale or an age it
  shows ticks"; "the record, bound values and the ages views show reach chrome through state the views observe"),
  **Invalidation and damage** ("a changed reading always invalidates"; never "miss a reading change").
- Issues #2117 and #4 (the epic). #1491 (panel signals) and #1482 are named out of scope and weren't followed.
- At the base: AGENTS.md; `crates/deep-app/src/panel_values.rs` (`BoundPanel`, its 1 s `TICK` that notifies with
  nothing compared, `shown`, `elements`), `main.rs` (`--panel <dir>`: `mount_panel`, then `elements`, then
  `BoundPanel::new`), `record.rs` (the one reader, `with_view`, `install_local`, `deliver`, `sync`, `observe`, the
  `Shown` entity views observe), `views.rs` (`now()`, `set_clock`, the terminal tab's revision compare),
  `canvas.rs` (`items`, `placed`, `clear_items`), `text.rs` (`label` records what it paints), `chrome.rs` (`of`,
  `muted`), `states.rs` (`Table::value`, `reading.recorded`), `lib.rs` (`init`, `mount_panel`, `refresh_panels`),
  `plain.rs` (`planted`), `Cargo.toml` (features, the `[[test]]` targets); `crates/deep-canvas-marks/src/scene.rs`
  (`bound_text`, `Shown`, the age's text and `changes_at`); `crates/deep-replica` (`headless_context`,
  `drive/frames.rs`: #1546's frames drawn only when GPUI holds the window dirty); `vendor/gpui-pre`'s
  `HeadlessAppContext` (`request_frame`, `present_frame`, `capture_screenshot`, `advance_clock`) and the test
  scheduler's timers; gpui-kit's `open_window` and `Root`; the suites `tests/acceptance/1172/` (`panel.test.ts`, its
  README and fixture), `401/`, `995/app/panel.rs` (a headless window in a deep-app `[[test]]`), `1141/` (plants as
  cargo features, run by name), `1510/` (Rust test names carrying criterion IDs) and `1899/` (this README's shape).

What the base already does and these tests don't credit: `BoundPanel` draws each bound line from the one reader's
newest reading through the canvas's bound-value text, in the look's muted role with its age once stale (#1172); a
headless window can be asked for a frame that GPUI draws only when dirty (#1546's `request_frame`); the views' clock
is settable in a fixtures build. What it doesn't do is the issue: the panel notifies every second whatever changed, so
a still panel draws a frame a second; nothing arms a frame at the moment a value goes stale or its age ticks; and a
new reading reaches the panel only on its next tick. So every criterion fails at the base on its own reading
(`BASE-FAILURE.txt`).

## Run them

On macOS (the headless renderer draws the frames AC2 reads), with cargo on `PATH`:

```sh
cargo test --locked -p deep-app --test acceptance_2117                       # the five criteria; the plants are ignored
cargo test --locked -p deep-app --features plant-panel-ticks            --test acceptance_2117 -- plant_panel_ticks
cargo test --locked -p deep-app --features plant-panel-grays-on-reading --test acceptance_2117 -- plant_panel_grays_on_reading
cargo test --locked -p deep-app --features plant-panel-waits-for-redraw --test acceptance_2117 -- plant_panel_waits_for_redraw
```

`-- <part of a name>` runs the tests whose names hold it. The binary has no libtest harness (AppKit wants the main
thread); it prints libtest's lines, and runs each test in a process of its own (itself again, with `DA2117_ONE`
naming the test), so no thread-local of one test's app (the reader, the views' clock, the canvas text's atlas) reaches
another's. Every test is on GPUI's virtual clock and the views' clock, so nothing depends on this machine's speed or
load. Off macOS a test that reads pixels says `INCONCLUSIVE`, never PASS. In a plant's build, run only that plant's
test: the criteria's own tests fail there, as they should.

The implementer adds, and nothing else outside this folder is needed (no `scripts/lanes.mjs` line: `cargo test
--workspace` runs the target, as it runs `acceptance_995`):

```toml
# crates/deep-app/Cargo.toml, [features]
# Issue #2117's wrong programs, in no shipped build (tests/acceptance/2117): a panel that also notifies on a 1 s timer,
# one that grays a value only when a new reading reaches it, and one that shows a new reading only when another view
# redraws.
plant-panel-ticks = []
plant-panel-grays-on-reading = []
plant-panel-waits-for-redraw = []

# crates/deep-app/Cargo.toml, after the other [[test]] entries
# Issue #2117: a plug-in panel's bound value redraws when what it shows changes, written blind in tests/acceptance/2117.
# Each test runs in a process of its own; AppKit needs the main thread, so no libtest harness.
[[test]]
name = "acceptance_2117"
path = "../../tests/acceptance/2117/app/panel.rs"
harness = false
```

## The surface under test

Everything the tests call exists at the base; the implementer keeps it working and adds only the three plants. No new
function, flag or binary.

- **The panel as the app makes it.** `deep_app::panel_values::elements(dir)` reads `fixtures/panel/panel.json` (one
  element, `price`, bound to `reading:quotes`, USD to 2 places, `stale_after` 120,000 ms), and
  `deep_app::panel_values::BoundPanel::new(script: AnyView, elements: Vec<(String, Value)>, cx: &mut
  Context<BoundPanel>)` makes the panel, as `main.rs` does for `--panel <dir>`. The signature stays as it is.
- **The window.** `gpui_kit::open_window` (the app's `Root`) holds a content view the test owns, which draws the panel
  on the look's `ground`; the panel's script is a view the test owns that draws nothing. Both count their renders, and
  `App::observe` counts the notifies of the panel, the content and the script. The window is the panel alone, as AC1
  says "a window with one bound panel": the shell's other views observe the record themselves (#1546) and draw on any
  record move, which is outside this issue.
- **The record.** `deep_app::record::install_local(events)` gives the one reader a record holding one
  `reading.recorded` (`{"reading": "reading:quotes", "value", "as_of"}`); `deep_app::record::deliver(event, cx)`
  hands it a new one as the hub's stream does, and `record::with_view(|v| v.table().value(...))` confirms it holds it.
- **The clocks.** `deep_app::views::set_clock(ms)` (the `fixtures` build) and `HeadlessAppContext::advance_clock`
  move together one millisecond at a time from the first frame at 1,800,000,000,000 ms, `run_until_parked` after
  each. So the panel must take the time from `views::now()`, as it does at the base, and run what it arms on GPUI's
  executor (a `cx.background_executor().timer(…)` or anything else the test scheduler drives), so a timer armed for a
  moment fires at that millisecond.
- **Frames.** A 60 Hz display: vsync k at `k × 1000 / 60` ms after the first frame, on a whole ms. The window opens
  with `inactive_frame_interval: None`, so no wall-clock throttle skips a request, and after its first frame
  `HeadlessAppContext::draw_on_request()` (#1546's patch) stops GPUI's test mode from drawing a dirty window at the
  end of every update. At each vsync one `HeadlessAppContext::request_frame(window)` (#1546's patch: a frame request
  with no forced render) returns whether the window drew. "The window draws a frame" is that `true`. Without
  `draw_on_request` every notify draws at once and no request ever finds the window dirty; this job's first base run
  read 0 frames that way, with the content rendered 60 times, and the harness was fixed before anything was kept.
- **What a frame drew of the line.** `deep_app::canvas::clear_items()` before each request; after it, the item
  `canvas::items()` holds under the element's id (`price`), recorded when the canvas text paints it (`text::label`),
  gives the text drawn, and `canvas::placed()` its box. **The panel renders** in a frame that painted its line: in
  this window every draw re-renders every uncached view, so that is `BoundPanel::render`'s count, and it holds however
  the panel is split into views.
- **The role a line is drawn in** is read off the last drawn frame's pixels: `HeadlessAppContext::capture_screenshot`
  (which rasterizes that frame's scene and lays nothing out), the pixel in the line's box farthest from the look's
  `ground`, and which of the look's `muted`, `ink_primary` and `ink_secondary` (`deep_app::chrome::of(window)`) is
  nearest it. In light, `muted` is #8b8f97 and `ink_primary` #1b1d22.
- **What the line should show** at a time is the canvas's own `deep_canvas_marks::scene::bound_text` over the
  element's `bind`, as `panel_values` asks it (#1172): `182.40 USD` fresh, `182.40 USD · 2 min old` stale.

## The plants

Each is a cargo feature of deep-app, in no shipped build, applied to the fixed panel: the rest of the fix stays.

| Feature | What the plant must do | Which test fails on it, and how |
|---|---|---|
| `plant-panel-ticks` | The panel also notifies itself on a 1 s timer from the moment it's made, comparing nothing, as the merge base's `TICK` loop does | `plant_panel_ticks_…` runs AC1 and requires it to fail naming the view, `BoundPanel` (60 renders and 60 frames) |
| `plant-panel-grays-on-reading` | The panel arms nothing for the moment a value goes stale or its shown age ticks: it works out a line's stale state only when a new reading reaches it from the reader | `plant_panel_grays_on_reading_…` runs AC2 and requires it to fail naming the element, `` `price` ``, shown "as live" |
| `plant-panel-waits-for-redraw` | The panel takes nothing from the reader: a new reading shows only when the panel renders for another reason, such as another view's redraw | `plant_panel_waits_for_redraw_…` runs AC4 and requires it to fail naming the source, `reading:quotes` |

In the default build each plant's test is reported `ignored`, with the feature it needs.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading
`- [ ] ` dropped (#607's command, as #305's README gives it), over the issue's five criterion lines. Each test's name
starts with its criterion's number and ID, as #1510's do.

| ID | Criterion (the issue's text) | Test, what it asserts, and the wrong program |
|---|---|---|
| `#2117.789c5dd8` | A window with one bound panel whose reading doesn't change and whose `stale_after` is 120 s, held for 60 s on the virtual clock: after the first frame the panel renders 0 times and the window draws 0 frames. The merge base reads 60 of each. A planted timer that notifies every second fails, naming the view | `ac1_789c5dd8_…`: the reading as of the first frame, held 3,600 vsyncs (60 s): no frame drawn, and the panel, its script and the content rendered 0 times. Prints each count. Wrong programs: the base (60 and 60), `plant-panel-ticks` (fails naming `BoundPanel`) |
| `#2117.ebc91643` | The value goes stale at its as-of time plus `stale_after`: the frame at that time draws it in the muted role with its age, and no frame is drawn before it. A planted panel that waits for the next reading before graying shows a stale number as live and fails, naming the element | `ac2_ebc91643_…`: the reading as of 117.5 s before the first frame, so it goes stale at 2.500 s, vsync 150. No frame at vsyncs 1–149; vsync 150 draws, the line reads `182.40 USD · 2 min old` and its ink is nearest `muted`. Its twin in the same test: the first frame drew `182.40 USD`, not nearest `muted`. Wrong programs: the base (frames at 1 and 2 s, none at 2.5 s), `plant-panel-grays-on-reading` (no frame at 2.5 s: `` `price` `` shown as live, in ink) |
| `#2117.426efcc0` | While a value is stale, the panel renders once for each change of the age it shows, and never between | `ac3_426efcc0_…`: the reading 150.3 s old at the first frame (`· 2 min old`), held 10,800 vsyncs (180 s). The text the canvas gives changes at 29.700, 89.700 and 149.700 s (3, 4 and 5 min old); the panel renders at exactly those vsyncs, each showing that text, and at no other. Wrong program: the base (180 renders, each 0.3 s after a change or with none) |
| `#2117.0504b71f` | A new reading shows within 2 frames of the record's reader holding it, with no other view notified. The merge base takes up to 1 s. A planted panel that waits for another view's redraw fails, naming the source | `ac4_0504b71f_…`: right after vsync 618 (10.300 s) the reader is handed 190.10 USD as of then; the line shows `190.10 USD` in a frame drawn at vsync 619 or 620, and until it shows neither the content nor the script is notified. Waits up to 120 vsyncs to report how late. Wrong programs: the base (42 frames, 700 ms, at its 11 s tick), `plant-panel-waits-for-redraw` (never within 2 s, naming `reading:quotes`) |
| `#2117.2a24617a` | A reading equal to the one shown renders 0 views and draws 0 frames | `ac5_2a24617a_…`: right after vsync 60 (1 s) the reader is handed 182.40 USD again, as of then; over the next 120 vsyncs (2 s) no frame is drawn and the panel, its script and the content render 0 times. Wrong programs: the base (its ticks at 2 and 3 s); a panel that notifies on every reading it's handed |

## Readings where the issue and design leave a choice

- **"The panel renders"** is a frame in which the panel painted its bound line. GPUI re-renders every uncached view
  when a window draws, so in this window a draw renders the panel, and the issue's own count ("60 of each") reads the
  same. "Renders 0 views" (AC5) counts the panel, its script and the window's content.
- **"After the first frame"**: the count starts after the first frame the window draws, at the first instant, and
  every frame after it counts, however it was caused.
- **"The frame at that time"** is the vsync at as-of + `stale_after` exactly: the canvas reads a value stale once its
  age reaches `stale_after` (`age < after` is fresh), and the fixture puts that moment on a vsync, at 2.500 s, half
  a second off the base's tick so the base's lateness shows. A frame drawn a vsync later is late.
- **"With its age"** and **"the age it shows"** are what the canvas's bound-value text writes, `· N min old` from a
  minute on; AC3 holds minutes because a value stale after 120 s is never younger. "Once for each change" is a render
  at the vsync where the text changes, showing the new text; a render without a change, or a change rendered late,
  fails it.
- **"The muted role"** is judged on pixels, the nearest role to the line's ink, as #1172 judged it; the twin keeps a
  panel that grays everything from passing.
- **"Within 2 frames of the record's reader holding it"**: the reader holds the reading from `deliver` on, just after
  a vsync, so the line must show at the next vsync or the one after. **"With no other view notified"** is asserted
  (the content and the script get no notify until the line shows) and is also the condition that leaves a panel
  waiting for another view's redraw nothing to wait for.
- **"Naming the view / the element / the source"**: the view is `BoundPanel`; the element is the bound element's id,
  `price`; the source is the bound value's `source`, `reading:quotes` (the design's name for that field), not a view
  whose redraw the plant waits for, since in this test none redraws.
- **"A reading equal to the one shown"** is a new `reading.recorded` with the same value and a newer as-of: the text
  and stale state shown don't change, though the stale moment moves. Held 2 s so the base's tick shows.
- **The script.** A stand-in, not a mounted gpui-shell script: at the base `record::sync` refreshes every mounted
  script on every record move (`refresh_panels`, #1459), so a mounted one would draw on AC5's reading whatever the
  panel does. Scripts reading the record are panel signals' (#1491), out of scope here.
- **The base runs.** Every test compiles and runs at the base with only the `[[test]]` entry added (rustc warns there
  that the three plant features are undeclared; declaring them ends that), so its failures in `BASE-FAILURE.txt` are
  its readings, not a missing surface. That file also says what a throwaway sketch of the fix, run and reverted,
  showed about the harness.

Not tested, because no criterion asks: that only one timer is armed and none wakes while every value is fresh (Scope;
wakeups aren't observable here except as renders and frames); several bound lines coalescing into one frame; a
mounted script rendering only when its structure changes; the full shell; dark appearance; a replayed film's pinned
frame.

## Files

- `app/panel.rs`: the five criteria, the three plants' tests, the window, the clocks and the runner.
- `fixtures/panel/panel.json`: the plug-in panel's element tree, one bound line.
- `BASE-FAILURE.txt`: the run at the base.

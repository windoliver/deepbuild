# Acceptance tests for #400: windows on any display, each paced by its own display

Written first, from issue #400 (its scope, its Window and display placement and Frame clock and scheduler fields,
its four acceptance criteria and its proof line), the design sections it links and those they lean on, and base
commit `a8e5480` ("Merge pull request #767 … feat/63-read-by-reference"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Panels and devices (trusted ring) (1947): Panel ("Focus moves, pop-outs … need a
  gesture serial from your input in that panel"; "It can never: … draw outside its panel or over the question
  card"); Keymap, placement, window (1977: "any view can pop out into its own window, on any display and full screen
  there, and the layout remembers it"; "It can never: … open a window you didn't"); Full screen (716); Dogfooding
  (2518) and Tests written first (2549); the budget rules (2405–2420).
- `docs/canvas-primitives.md`: Admission and latch (703: "At the latch, vsync minus the lead, each session takes its
  newest checked revision"); Frame clock and scheduler (723: the per-display, per-window and per-session fields;
  "Arms a frame only on a commit, … input …", "Each window is paced by its own display (the faster one if it spans
  two)", the kit case on a virtual display clock; "It can never: Draw unasked; evaluate a hidden session; block the
  UI thread on the GPU; give a writer more callbacks than presented frames"); Frame callback and presentation feedback
  (756: `{session, rev, frame_seq, presented_at_ns | discarded, refresh_ns, flags}`, "One callback per presented
  frame"); Band (771: the card always last); Question card (785: `display: the one with your latest input`, `state:
  hidden | presented(seq, t) | armed | …`, `arm_after: ms = 500`, `rearm_on: content | move | resize | occluded |
  display | activation`; "It arms after the interval while still and unobscured, any change re-arms it"; "Each
  `rearm_on` change returns the card to presented and restarts the interval"; "It can never: … be covered, even
  partly"; "a test drives it with recorded input on the virtual clock"); Input router, focus and gesture serial (799:
  "every delivered input gets a serial for that writer … Focus, pop-outs … all need a serial, and agents never hold
  one"); GPU surface (843); Window and display placement (891: `{window, kind: main | popped(view) | full_screen,
  display: {uuid, scale, refresh, color_space}, saved_positions, opened_by: serial | restore, surfaces}`; "Only the
  shell places windows, and a pop-out needs a serial. Displays are remembered by UUID, each window is paced by its
  own display, and the card goes to the display with your latest input"; "It can never: Open, move or resize itself;
  take the card off your screen"); Meter and degrade ladder (905, for the app-wide GPU budget).
- At the base: AGENTS.md; `tests/acceptance/383/` (its `deep-show run` calls `input`, `scope` and `presented`, the
  `display` field, the Driver that replays a scenario step by step), `393/` (`deep-show run` and its JSON-lines
  convention, the scenario's `window` and `card`, the card composed last), `96/` (shared documents, patches, the
  virtual display clock, the checker and a patch reply's `checked` and `current`), `377/`, `379/` and `372/` (their
  READMEs, for conventions); `crates/deep-show` (`src/main.rs`'s scenario fields and calls, `src/input.rs`'s
  `presented`, `src/hub.rs`'s `Card`, `src/window.rs`), `crates/deep-app` (the shell: no window placement, no card
  state), `crates/deep-canvas-motion/src/clock.rs`.

What the base already does and these tests don't credit: `deep-show run` presents documents in panels of one window,
applies agents' patches through one checker, and on a virtual clock with one `refresh_hz` makes revisions current at
a latch and reports the frames a panel presented (#96, #383); `input` gives your input a serial and `scope` reads a
panel's canvas (#383); the scenario's `card` is a static slot in the window that `screen` composes last (#393). There
is no display but the one `display: [w, h]`, no window but the main one, no pop-out, no layout to save or restore,
no frame pacing per display, and no card state (presented, armed, re-armed) or card placement.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/400 --no-file-parallelism
npx tsc -p tests/acceptance/400/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds `deep-show` once with `cargo build --locked --bin deep-show` in the checkout, copies it out of
`target/debug` into a temporary folder, and fails each of its tests when the build fails. Each test writes into its
own temporary evidence folder and deletes it. The tests use node built-ins and vitest only. A run with `--root
tests/acceptance/400` may leave Vitest's cache in `tests/acceptance/400/node_modules/.vite` or a `.vitest` folder;
delete it. `scripts/lanes.mjs` needs `tests/acceptance/400/` in its one-at-a-time list beside `383/`, since the files
build a cargo binary; this README is the instruction, and the implementer makes that edit.

Everything is deterministic and runs on every platform: the scenarios run on the hub's virtual display clock and read
no wall time, and nothing here draws pixels or times the GPU. `BASE-FAILURE.txt` is the run at the base (home paths
redacted): all 6 tests fail, each because `deep-show run` answers the scenario `{"ok": false, "code":
"bad_input"}`: the base parser refuses the `clock` with no `refresh_hz` (with `displays`, each display carries its
own) and has no `pop_out`, `move_window`, `windows`, `layout` or `card` call. That is the missing surface, not a test
mistake: every scenario here needs it.

Nothing missing passes (invariant 2): a reply without a field the tests read fails the test naming the field; a run
that answers `bad_input`, exits non-zero or writes fewer lines than it read fails every test that drove it. No test
skips, and none reads a real display, so none is INCONCLUSIVE.

## The surface under test

The issue names displays, windows, pop-outs, the layout, a frame clock per display, presented frames and the
question card, but no code API. So these tests extend the one binary that already plays the hub's canvas side and its
window for tests, `deep-show run` (#393, #96, #383), with the smallest set of fields and calls they need, in its own
style. No new binary.

### The JSON-lines convention

#393's: one JSON object per stdin line, exactly one JSON object per input line out, in order, then exit 0. A line that
isn't JSON, lacks a required field or names an unknown `planted` value answers `{"ok": false, "code": "bad_input"}`.
A scenario that runs answers `{"ok": true, "replies": [Reply]}`, one reply per call, in order.

### The scenario: fields added and changed

#393's, #96's and #383's scenario, unchanged except for these. Every scenario here has `clock`, so every call carries
`at` (flicks) and calls arrive in `at` order.

- `displays: [Display]`: the displays connected, the **first is the main display**. It replaces #383's `display: [w,
  h]` (a scenario has one or the other).

  ```json
  {"uuid": string, "bounds": [x, y, w, h], "scale": n, "refresh_hz": n, "next_vsync": flicks, "color_space": string}
  ```

  `bounds` are in global points (the main display's top-left is the origin, y down; another display may sit at
  negative coordinates); `scale` is device px per point; `refresh_hz` the display's refresh; `next_vsync` its first
  vsync, after which it vsyncs every `705,600,000 ÷ refresh_hz` flicks (Frame clock: per display `{uuid, refresh_ns,
  next_vsync, latch_lead_ns}`); `color_space` is carried, not read.
- `clock: {"lead": flicks, "check": flicks}`: with `displays`, the clock carries **no `refresh_hz`**; each display has
  its own. The latch of a display is each of its vsyncs minus `lead`. `check` is #96's (the one checker's time per
  patch).
- `window: [w, h]`: #393's, now in points: the main window's size. Without a `layout`, the main window opens on the
  main display with its top-left at that display's `bounds` origin; `panels` are in it, in window px as before.
- `layout`: a layout a `layout` call returned in an earlier run; the run starts with the app reopened from it (the
  main window and each pop-out it holds, `opened_by: "restore"`), each window on the display whose UUID it names.
- `card: {"ask": handle, "question": string, "options": [{"id", "label"}], "size": [w, h], "at": flicks}`: with
  `displays`, #393's card gains `at`, when the ask is created, and gives its measured `size` in points instead of a
  `rect`: the shell places it (Question card: on the display with your latest input, in a window there, never off
  that display). It is presented at a vsync of its display at or after `at`.
- `planted`: the values below (Planted programs), beside the earlier suites'.

The documents and sessions are the earlier suites' (`docs`, `sessions`, `processes`, a seeded shared document with a
layer per agent, #96). A panel holds one view (its document). A view popped out leaves the main window and fills its
own window; its panel keeps its ID, so `input`, `scope` and `presented` still name it, with positions in its own
window's px.

### Calls and replies

- **`{"call": "pop_out", "at", "panel", "display": uuid, "serial": n, "full_screen"?: bool}`**: your pop-out of the
  panel's view onto that display, windowed or full screen there, pressed with the input whose `serial` the input
  router gave it (an `input` reply's `serial`). It opens only with a serial of your input in that same panel (Panel:
  "a gesture serial from your input in that panel"). Reply `{"window": Window}`, or a refusal `{"code": string}`
  with no `window` and nothing opened when the call has no `serial`, a serial of an input in another panel, or a
  `session` (an agent asking: agents never hold a serial). The code isn't read.
- **`{"call": "move_window", "at", "window": ID, "rect": [x, y, w, h]}`**: the window server's report that you
  dragged that window by its title bar to `rect` (global points). The window's display becomes the one holding most
  of it. A `move_window` with a `session` is an agent asking to move a window: refused `{"code": string}`, nothing
  moved.
- **`{"call": "windows", "at"}`** → `{"windows": [Window]}`: every open window.

  ```json
  Window: {"window": ID, "kind": "main" | "popped" | "full_screen", "view": panel ID | null, "display": uuid,
           "rect": [x, y, w, h], "opened_by": "serial" | "restore" | null}
  ```

  `kind` and `view` are the design's `main | popped(view) | full_screen` (a full-screen window names its view too);
  the main window's `view` is `null`. `display` is the UUID of the display that paces it; `rect` is in global points;
  a full-screen window's `rect` is its display's `bounds`. `opened_by` is `serial` for a pop-out you made, `restore`
  for a window the layout reopened; the main window's isn't read.
- **`{"call": "layout", "at"}`** → `{"layout": Layout}`: the layout as the app would save it now (`saved_positions`),
  which a later scenario's `layout` takes back as is. Layout is `{"windows": [{"window", "kind", "view", "display":
  uuid, "rect"}, …], …}`: the tests read only each row's `view`, `kind` and `display`; anything else in it is the
  implementer's.
- **`{"call": "card", "at"}`** → `{"card": Card | null}`: the question card as of `at` (`null` before its ask).

  ```json
  Card: {"ask": handle, "display": uuid, "window": ID, "rect": [x, y, w, h], "state": "hidden" | "presented" |
         "armed" | "answered" | "expired", "states": [{"state", "at": flicks}]}
  ```

  `display` and `window`: where it was presented; `rect` in global points; `state` its state at `at`; `states` every
  state it entered from its first presentation up to `at`, in order, each with the flick it entered it, starting
  `{"state": "presented", "at": P}` (P a vsync of its display). A re-arm that finds it already presented adds no
  entry. It arms `arm_after` (500 ms) after the later of its presentation and its last re-arm while still and
  unobscured; a window of the app's own lying over any part of it is occluded (`rearm_on: occluded`), so it can't arm
  while one does, and the window leaving it is a change that restarts the interval. On the virtual clock it may
  enter `armed` at the first vsync of its display at or after that instant, never before it.
- **`presented`** (#383's `{"call": "presented", "at", "panel"}`): each frame gains three fields:
  `{"vsync", "rev", "camera", "window": ID, "display": uuid, "frame_seq": n}`: the window that presented it, the
  display that paced it (its vsync is one of that display's), and that window's frame sequence number, one more for
  each frame the window presents (Frame callback: `frame_seq`). `rev` is the revision of the panel's document drawn,
  the newest that was checked by that frame's latch (Admission and latch); `vsync` is its presentation time on the
  virtual clock.
- **`input`** (#383's) is unchanged: its reply's `serial` is what `pop_out` carries, and an input is "your latest
  input" on the display of the window its panel is in.
- **A patch** (#96's `deep_show` with `patch`) is unchanged; the tests read its reply's `outcome`, `rev` and
  `checked`.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; every test runs its own and
asserts that it fails.

| Name | The wrong program | Test |
|---|---|---|
| `restores_to_main` | on restore, every popped or full-screen view reopens on the main display | AC1 |
| `card_on_main_display` | the card always opens on the main window's display | AC2 |
| `one_clock_for_all` | every window is paced by the main display's clock (its vsyncs and latches) | AC3 |
| `arms_under_own_window` | the card ignores the app's own windows when it judges whether it is obscured | AC4 |

## Criteria to tests

Each test's name starts with its ID. Each returns its criterion's failures as sentences naming what failed, and runs
its wrong program to show the same check fails on it.

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A view popped out to a second display reopens there | `windows.test.ts`: displays A (main, 120 Hz, 1512 × 982 at 2×) and B (60 Hz, 1920 × 1080 at 1×, right of A). You click y and pop it out onto B with that click's serial, and click z and pop it out full screen onto B: y is `popped` on B inside B's bounds, `opened_by: serial`; z is `full_screen` on B with B's bounds; the layout names B's UUID for both. Restarted from that layout with the displays listed B first and B moved left of A (`[-1920, -98, 1920, 1080]`): the main window on A, y `popped` on B by UUID inside B's new bounds, z `full_screen` filling B's new bounds, both `opened_by: restore`, three windows; y's frames are paced by B, at B's vsyncs. Fails on: `restores_to_main`; and, by the reordered and moved displays, a restore by list index or by the old global position |
| AC2 | With views on two displays, the question card opens on the display you're using | `card.test.ts`: x in the main window on A, y popped out onto B. You click x and then y, and the ask arrives: the card is on B, inside B's bounds, in a window on B, presented at or after the ask. You click y and then x: the card is on A. Fails on: `card_on_main_display`; and, by the two orders, a card on the display of your first input, of the newest window, or of the popped view |
| AC3 | Windows on 60 Hz and 120 Hz displays present at their own rates, and each frame shows every writer's newest revision at the latch | `frames.test.ts`: shared boards x (main window, A, 120 Hz) and y (popped out onto B, 60 Hz, vsyncs 3 ms out of A's phase); alpha and bravo by turns patch each board every 2 ms for 300 ms (a new revision before every latch of either display). In 250 ms x presents exactly 30 frames and y exactly 15; every frame of x is at a vsync of A, paced by A, in x's window, and of y at a vsync of B, paced by B, in y's window; `frame_seq` goes up by one per frame; at each frame, for alpha and for bravo, no revision of theirs checked by the frame's latch (vsync − 2 ms) is newer than the frame's revision, and the frame holds no patch checked after its latch; once the patches have shown, neither window presents another frame (never drawn unasked). Fails on: `one_clock_for_all`; and a window paced at the other display's rate, one latching on the other display's latches, one a frame late, one that presents every vsync whatever changed |
| AC4 | A view you pop out and drag over part of the presented card keeps it unarmed while they overlap, and the card arms 500 ms after the window moves off; a card that arms under the app's own window fails, naming the window | `card.test.ts`: y popped out onto A; you click x, so the ask's card opens on A. From 100 ms after the card is presented, y's window is dragged (16 `move_window`s, 100 ms apart, wiggling 2 points) over its bottom-right corner, 40 × 30 points of it, for 1.6 s, then off it. Mid-drag `windows` shows y covering part, not all, of the card; after, y is clear of it. The card never enters `armed` before the window leaves, nor within 500 ms of it; 499 ms after it isn't armed; 500 ms and a frame after it is, its `armed` entry at most a frame past the 500 ms; the presented card never moves. Fails on: `arms_under_own_window`, the failure naming y's window ID; and a card that arms 500 ms after presentation whatever lies over it, one that never re-arms when the window leaves, and one that never arms |
| Rules | A pop-out without a serial is refused; nothing opens or moves a window itself (Window and display placement: "It can never: Open, move or resize itself"; Panel; Input router) | `windows.test.ts`: a pop-out of y with no serial, with the serial of your click in x, and with your serial but asked by alpha's session are each refused with a code and no window, and only the main window is open; your click in y and a pop-out with its serial then opens y on B, `opened_by: serial`. After y is popped out, alpha re-sends x's and y's documents, alpha's `move_window` of y's window is refused, and the ask's card is presented: the `windows` reply at the end equals the one right after the pop-out. Fails on: a pop-out that needs no serial or takes any serial or an agent's ask; a window the shell moves or opens for a card, a revision or an agent |

The proof line ("a two-display layout with the card on your display, and each window's presented rate") is these
runs: AC1's and AC2's `windows` and `card` replies, and AC3's frame counts per window.

## Readings where the issue and design leave a choice

- **One binary standing in for the shell's window placement.** The shell and its windows run in `deep-app`, which a
  test can't drive headless across two real displays; `deep-show run` already plays the hub's canvas side, its
  panels and its card for tests (#393, #383), so the displays, windows and card are its scenario fields and calls.
  The displays are virtual, so no reading is INCONCLUSIVE for want of a second monitor.
- **"A view popped out to a second display"** is a pop-out that names the display (the shell places the window
  there); "reopens there" is a restart from the saved layout, its window on the display with the same UUID, inside
  that display's bounds. The restore lists the displays in another order and moves B in the arrangement, so only the
  UUID leads back to B ("Displays are remembered by UUID"). Where on B the window lands isn't read beyond its bounds.
  The full-screen pop-out is the scope's "on any display and full screen there, remembered in the layout", read in
  the same AC1 test; a full-screen window's rect is its display's bounds.
- **"The display you're using"** is the design's "the display with your latest input": the display of the window
  whose panel took your last `input`. A pop-out isn't an input of its own; the click whose serial it carries is.
- **"Present at their own rates"** is read as a frame at every vsync of the window's own display while every latch
  has a new revision, and at no vsync of another display, counted exactly over 250 ms on the virtual clock (30 at
  120 Hz, 15 at 60 Hz). Frames on demand ("Arms a frame only on a commit …", "It can never: Draw unasked") make a
  rate only while there's something new, so the writers patch faster than either display refreshes, and when they
  stop the frames stop. B's vsyncs are 3 ms out of A's phase so that a window latching on the wrong display draws a
  different revision.
- **The 30 Hz `inactive` cap** (Frame clock: `caps: {inactive: 30 Hz, …}`) is read as the app inactive (no window
  of the app active), not as "every window but the key one": the criterion has two windows presenting at 60 and
  120 Hz at once, which a cap on the non-key window would forbid. No run here makes the app inactive. The owner
  should confirm; a redraft changes nothing else.
- **"Every writer's newest revision at the latch"** is read on shared documents two agents write (#96): a frame at
  vsync v of its display draws the newest revision checked by v − lead (Admission and latch: "each session takes its
  newest checked revision"), so for each writer, its newest patch checked by then is in the frame and none checked
  later is. Revisions are numbered in the order they become current, as #96 numbers them, so "in the frame" is
  "revision ≤ the frame's". A patch's `checked` is read from its reply, as #383's AC4 reads `current`.
- **The card and the app's own window.** The design says the card can never be covered and that the card arms only
  "while still and unobscured"; the criterion has you drag a popped-out window over part of it. Read together: a
  window of the app's own over the card (a separate OS window stacked above the main window) occludes it
  (`rearm_on: occluded`), so it stays presented, unarmed; the window leaving it is the change that restarts the
  500 ms. "Arms 500 ms after the window moves off" allows the first vsync of the card's display at or after that
  instant (at most a frame, 8.33 ms on A), never earlier. "Fails, naming the window" is the planted program's
  failure sentence, which names the window ID.
- **"The question card stays on the screen you're using"** (scope) and "never take the card off your screen" are
  read in AC2 (where it opens) and AC4 (the presented card's display and rect never change while windows move).
- **A pop-out's serial** must come from your input in that panel (Panel), and an agent's call never carries one
  (Input router: "agents never hold one"); a serial's 30 s expiry isn't read. **"Open, move or resize itself"** is
  read as: no window opens, moves or resizes but by your pop-out, your drag or the restore; an agent's
  `move_window` is refused, and a card, a revision or an agent's documents change no window.

Not tested, because no criterion asks: the one app-wide GPU budget and one device and cache for every window (the
scope names it; no criterion gives a number or an observable, and #377's and #380's suites own the GPU budget), scale
changes reallocating lazily, a window spanning two displays paced by the faster, the thermal and hidden caps, present
mode moving the card to another display, a pop-out within 300 ms, display hot-plug, the card's answer, typing on it
and its other `rearm_on` causes.

## The Oracle lane

The issue names no upstream test; window placement by display UUID, per-display pacing on a virtual clock and the
card's arming rules are this design's own, so nothing upstream is ported and these tests are the local proof for
every criterion.

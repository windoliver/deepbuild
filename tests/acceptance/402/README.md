# Acceptance tests for #402: terminals and the cells module: streams with backpressure, raw input, and the cell grid

Written first, from issue #402 (updatedAt 2026-10-30T02:23:23Z: its scope, its Fields, its nine acceptance criteria and
its proof line), the design sections it links and those they lean on, and base commit `46e622f8` ("Merge pull request
#811 from windoliver/feat/69-plans-before-acting"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

What was read:

- `docs/technical-design.md`: Blocks for plug-ins that host something live (511: Stream "ordered … A terminal's or a
  log's stream applies backpressure instead of silently dropping output; a sound or video stream drops late frames and
  counts them. A stream is never written to the record, though a snapshot of it can be saved as evidence, and only the
  panels it was opened for can read it"; Canvas "a terminal's extension parses output in its own process and sends screen
  changes"; Raw input "from you … An agent can't send it, and a panel without focus doesn't get it"; Run-as-you
  permission; Still off-limits "Input to a terminal comes only from your focused panel … What a screen shows is a
  reading at best, never evidence of an agent's state"); Panels and devices (trusted ring): Panel (1961: a plug-in's
  words are one send per serial, "marked with the plug-in's name"), Stream and raw input (1989: "Stream: ordered output
  to a plug-in's own views, with backpressure for terminals and drop-and-count for sound and video … Raw input: keys
  (press, repeat, release), text, paste, mouse, focus and resize, from a panel you focused. It can never: Reach another
  plug-in, or come from an agent"), Cell grid (2002: "Clipboard writes are shown and clipboard reads refused, and bells
  become a badge … It can never: Become evidence of an agent's state"); the DeepBuild app row of the component table
  (80: a session's page has tabs "for its line …, its asks, its checks and, from R2 with the cell grid, its terminal when
  the hub hosts it"); Starting a session from the app (409: "a terminal the hub hosts … held by a small host process the
  supervisor starts for it, so the session keeps running when the app quits"; "for a session the hub hosts, its terminal
  tab, while a session in a terminal the hub doesn't host says where it runs, with Open"); Claim (932: "A claim that
  fails goes back naming what's missing"), Check, Verdict (962: "PASS, FAIL, INVALID, BLOCKED or INCONCLUSIVE"), Evidence
  (986); the canvas modules table (1066: `cells` … Depends on `text` … R2); the Threats rows about terminals, the
  clipboard and panels; the budget rules (reference Macs, five runs after warm-up, the margin, INCONCLUSIVE elsewhere);
  Dogfooding and Tests written first; AGENTS.md's four invariants.
- `docs/canvas-primitives.md`: The status-color rule (71: "a color that a plug-in or a terminal cell asks for inside that
  distance becomes the nearest allowed color … Any other document … may use any palette; it still can't draw a status
  color, since status roles are reachable only through a binding"); Input router, focus and gesture serial (799:
  `serial_ring[writer]`, "keys go only to the focused panel", "agents never hold one", "It can never: Feed an unfocused
  panel; accept another writer's serial; … let an agent type"); Panel runtime and panel host (877: "output: element tree
  per invalidation … runs in an out-of-process panel host … It can never: Reach … the network or a program"); Window and
  display placement (891); Frame clock and scheduler (723); Canvas module (990), Canvas module: interface and
  implementation (1015); Registry and seal (1034: "`r2` adds vector, cells, scene3d and effects"); Seam and backend (1200)
  and its device classes (1218: the input seam); Look `look@1` (2407: status distance); Cell grid `cells@1` (2369: Fields,
  Semantics "clipboard writes are shown and reads refused, and a bell becomes a badge. Selection and copy belong to the
  app, as session state", Cost "under 5% of a core per terminal at 60 patches a second", "It can never: Draw a status
  color; read the clipboard; hold a selection; count as evidence of an agent's state"); Cell grid `cells@1`: logic grid
  (2389, R6, not tested); Asset: terminal recordings (7235, not tested: R6).
- At the base: AGENTS.md; `tests/acceptance/401/` (README, helpers and tests: the `install` call and panels'
  element trees, gesture serials, `focus`, `input`, `pop_out`, `windows`, the budgets helper and the INCONCLUSIVE rule;
  #401 is a dependency and is not implemented at this base either, so this suite leans on that README's surface),
  `400/` (displays and the virtual display clock), `383/` and `384/` (`input`), `393/`, `96/`, `388/`, `305/` and `371/`
  (the registry and seal, build sets, `module_missing`, `deep_show` documents), `403/` (document checks), `28/` (the
  verdict engine's claims, checks and runs); `crates/deep-show/src/{main.rs,input.rs,ring.rs,hub.rs,live.rs,
  placement.rs}`, `crates/deep-canvas/src/registry/mod.rs` (`BuildSet`, `KNOWN_MODULES`: `cells` is a known name first in
  R2), `crates/deep-app/src/views.rs` (the session page), `crates/deep-replica`, `packages/verdicts`, `packages/record`,
  `packages/hub`, `crates/deep-canvas-marks/looks/clean.json` (the status colors and `min_distance`), `scripts/lanes.mjs`,
  `scripts/benchmark.mjs`, `benchmarks/budgets.json`.

What the base already does and these tests don't credit: `deep-show run` presents documents in panels, gives each `input`
a serial, pops panels out onto displays on a virtual display clock (#393, #96, #383, #400); the registry and seal know
the name `cells` and refuse its kind with `module_missing` (no build holds the module); the verdict engine judges a
claim's checks and runs (#28) and records `verdict.made`; the clean look holds the status colors and their
`min_distance`. There is no PTY, no terminal emulator, no panel host process, no stream, no cell grid, no `serve`, no
raw-input route, no terminal tab on the session page and no claim citation in the repo.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/402 --no-file-parallelism
npx tsc -p tests/acceptance/402/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds `deep-show` once with `cargo build --locked --bin deep-show` (`registry.test.ts` also builds the
`r2`, `r1` and `core` build sets with `--no-default-features --features <set>`), copies it out of `target/debug` into
`/tmp/dh402-bin-*`, and fails each of its tests when the build fails. Tests that start processes make folders under
`/tmp/dh402-*` (a socket path must fit 104 bytes), give each child a `HOME` of its own, use no network, no model, no real
`claude` or `codex` binary and no real system clipboard, and stop only the processes they started, by PID (a stopped host
is continued before it is killed). A run with `--root tests/acceptance/402` may leave Vitest's cache in
`tests/acceptance/402/node_modules/.vite` or a `.vitest` folder; delete it. `scripts/lanes.mjs` needs
`tests/acceptance/402/` in its one-at-a-time list beside `400/` and `401/` (line 20), since the files build cargo binaries,
run 50 MB through a PTY and time budgets; this README is the instruction, and the implementer makes that edit.

Every test but the timing ones and AC5's, AC2's, AC6b's and AC7's real-process tests is deterministic and runs on every
platform that builds `deep-show`: the scenarios run on the hub's virtual display clock and read no wall time. The real
-process tests (`serve`) need a PTY and Node (`process.execPath` is the program's interpreter); AC5 stops a process for
10 s and runs 50 MB through a PTY, about two minutes. `budgets.test.ts`'s three timing tests count only on a reference Mac
(Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal state nominal and a 1-minute load no higher than its
core count; anywhere else they fail with a message starting `INCONCLUSIVE:`. They never pass, and never skip, on a reading
they can't trust.

`BASE-FAILURE.txt` is the run at the base: every test that needs the new surface fails, each for the reason it lists. A
test that passes at the base would say so there.

Nothing missing passes (invariant 2): a reply without a field a test reads fails the test naming the field; a run that
answers `bad_input`, exits non-zero or writes fewer lines than it read fails every test that drove it.

## The surface under test

The issue names behaviours (a terminal that keeps up, a clipboard escape that gets no reply, a backpressured stream, a
cell grid, raw input, a session page's terminal tab), but no code API. So these tests extend the one binary that already
plays the hub's canvas side and its window for tests, `deep-show` (#393, #96, #383, #400, #401), with the smallest set of
calls and fields they need, in its own style, plus one TypeScript declaration for the claim check. No new binary. Where
the issue says "real" the tests use real processes: a Node program on a real PTY, a panel host that is a process of its
own (the test stops and continues it by PID), and a real record (SQLite).

### Two ways to run `deep-show`

1. **`deep-show run`** (#393's convention, unchanged): one JSON scenario per stdin line, one reply line per scenario
   `{"ok": true, "replies": [Reply]}`, in call order, then exit 0; a line that isn't JSON, lacks a required field or names an
   unknown call or `planted` value answers `{"ok": false, "code": "bad_input"}`. Every scenario has #400's `displays` (A, the
   120 Hz main display; B, 60 Hz), `clock: {lead, check}` (the latch lead of 2 ms and the checker's 0.5 ms a patch),
   `window: [1200, 700]`, `panels: {ID: {rect}}` (window px), `sessions`, `processes`, `evidence`, optional `planted`; every call
   carries `at` (flicks, 705,600,000 a second) and calls arrive in `at` order. **Virtual clock, no wall time, no real
   process**: a terminal here is fed a recorded output.
2. **`deep-show serve`** (new; wall clock, real processes): reads line 1, a *setup* (a scenario without `calls`, with
   optional `clipboard: string` (the text on the test clipboard, which no program may read), `record: path` (an existing
   SQLite record in @deepbuild/record's format) and `planted`), and answers `{"ok": true}` or `{"ok": false, "code":
   "bad_input"}`. Each later line is one call, answered by one line in order as soon as it is done (a call's `at` is
   ignored: times are wall time). When stdin closes it ends every panel host and terminal program it started. `serve`
   answers the calls below that say so, and #401's `install`, `input`, `focus`, `windows` and `pop_out`.

#401's surface is used as that README defines it: **`{"call": "install", "plugin", "manifest"}`** with a manifest
`{"panels": {ID: {"tree": [Element], "raw_input"?: bool}}}` answers `{"installed": true}`; `input` (`down`, `up`, `move`
with `pos` in window px) gives a click in a panel its serial and the panel keyboard focus; `{"call": "focus"}` answers
`{"kb_focus": panel ID | null}`; `pop_out` takes a serial under 30 s old. This suite adds one element,
`{"id", "component": "cells", "terminal": terminal ID}`: the panel shows that terminal's cell grid (the canvas mounts in
the panel through the component registry). The terminal may be opened after the install: the panel draws nothing until it is. A panel that asks for raw input has `raw_input: true`.

### Terminals

- **`{"call": "terminal_open", "at", "terminal": ID, "panel": panel ID | "session": session ID, "cols", "rows",
  "history"?: rows (default 10,000), "feed"?: [{"at": flicks, "text": string}], "program"?: {"argv": [string], "env":
  {…}, "cwd"}, "stream"?: {"window": bytes}}`** → `{"opened": true, "terminal", "host": {"pid"} | null, "program": {"pid"} |
  null, "stream": stream ID}`. `panel` claims a plug-in's panel for it; `session` is the terminal the hub hosts for that
  session, drawn by the session page's tab. In `run` the terminal takes a `feed` (the program's output, recorded: each
  `text` arrives as UTF-8 at its `at`, as one chunk, and makes one update; `\u001b` is ESC) and `host` and `program` are
  null. In `serve` it takes a `program`, which runs on a real PTY of `cols` × `rows`, and a **panel host that is a process of
  its own**, not the hub's (`host.pid`); the hub reports both PIDs. The host holds the emulator and the cell grid and
  takes the program's output through the stream.
- **`{"call": "terminal_resize", "terminal", "cols", "rows"}`** (serve): the panel's size in cells changed: the program's
  PTY has the new size (SIGWINCH).
- **`{"call": "cells", "at", "terminal": ID}`** or **`{"call": "cells", "at", "session", "tab": "terminal"}`** → the grid as the
  cell grid shows it: `{"vsync": flicks | null, "revision": u64, "cols", "rows", "text": [string] (the screen's rows, right-
  trimmed), "cursor": {"x", "y", "shape": "block" | "bar" | "underline", "visible", "blink"}, "scroll": {"history": rows that
  left the top, "offset": rows scrolled back, 0 at the bottom}, "title": string | null, "cwd": string | null, "progress": 0..1
  | null, "bell": u32, "modes": {"alt_screen", "bracketed_paste", "app_cursor", "focus_events": bool, "mouse": "none" |
  "x10" | "sgr"}, "links": {ID: url}, "clipboard": {"writes": [text shown], "reads_refused": n}, "drawn_by": "cells@1"}`. In
  `run`, `vsync` is the presentation of the frame on screen at `at`; the grid has **no selection field** (Cell grid: "It can
  never: hold a selection").
- **`{"call": "cell", "at", "terminal" | "session"+"tab", "x", "y"}`** → `{"g": grapheme, "fg": "#rrggbb", "bg": "#rrggbb", "attrs":
  [name], "link": ID | null}`: one cell **as drawn** (after the status rule below). `attrs` are the frame's attribute names
  (`bold`, …).
- **`{"call": "rows", "terminal", "from", "count"}`** (serve) → `{"rows": [string]}`: rows of the whole grid, history first
  (index 0 is the oldest row kept), right-trimmed.
- **`{"call": "updates", "at", "terminal" | "session"+"tab"}`** → `{"updates": [{"revision": u64, "base": u64 | null, "at":
  flicks, "presented": flicks | null, "dropped": bool, "rows": n}]}`: one entry for every chunk the terminal was fed, in
  order. `base` is the revision it patched (the one before); `presented` is the vsync of the first frame of the panel (or
  tab) that draws it; `dropped` is true for one that was lost or merged into a later one; `rows` is the rows its patch
  holds.
- **`{"call": "stream_stats", "stream"}`** (serve) → `{"kind", "sent": bytes the program wrote that reached the hub,
  "delivered": bytes the host applied, "buffered": bytes held for it, "dropped": {"chunks", "bytes"}}`. **Answered by the hub
  while the host is stopped.**
- The grid is drawn through the cells module: `cells.drawn_by` is `cells@1`.

### Streams (virtual clock)

- **`{"call": "stream_open", "at", "stream", "kind": "video" | "sound", "panel", "source": {"fps": n, "from", "until"} |
  {"packets_per_second": n, "from", "until"}, "pauses": [{"from", "until"}]}`**: a source sends frame `seq` (from 1) at
  `from + (seq − 1)/rate` while that time is at most `until` (inclusive); the panel's window is paused in each pause (a frame whose time is in `[from, until)`
  cannot be shown); the stream drops what it cannot show on time and counts it.
- **`{"call": "stream", "at", "stream"}`** → `{"kind", "emitted": n, "shown": [{"seq", "pts", "presented"}], "dropped":
  {"count": n (the stream's own counter), "seqs": [seq]}}`.
- **`{"call": "stream_read", "at", "stream", "panel"}** → `{"frames": n}`, or a refusal `{"code"}` for a panel the stream
  wasn't opened for.

A terminal's stream applies backpressure: it never drops (`stream_stats.dropped` is 0); the hub stops reading the PTY while
its buffer (at most 16 MiB) is full, so the program's writes block.

### Input (serve)

- **`{"call": "seam", "event": SeamEvent}`** → `{"serial": n, "reached": ["panel:<ID>" | "shell"]}`: one event from the input
  seam's test backend, **naming no panel**. `SeamEvent`: `{"type": "key", "key", "phase": "press" | "repeat" | "release",
  "mods": []}`, `{"type": "text", "text"}`, `{"type": "paste", "text"}`, `{"type": "mouse", "pos": [x, y], "button": "left", "phase":
  "down" | "up"}`. The router decides where it goes: keys, text and paste to the focused panel only, the mouse to the panel
  under the pointer.
- **`{"call": "pointer", "pos": [x, y]}`** → `{"over": panel ID | null}`: the test backend's pointer moves (window px).
- **`{"call": "raw_input", "terminal", "by": {"session": session ID}, "bytes": string}`**: a write of raw input into the terminal
  from an agent's session. Refused `{"code": string, "writer": string}`, the writer naming the session (its ID); nothing
  reaches the program. Raw input from your focused panel comes only through `seam`.

A key press sends its character, a repeat sends it again, a release sends nothing (a legacy terminal has no escape for
it); text sends its UTF-8; a paste is wrapped in `ESC[200~ … ESC[201~` when the program asked for bracketed paste; a mouse
press and release are SGR (`ESC[<0;x;yM`, `…m`) when it asked for mode 1000 and 1006; a program that asked for focus
events (1004) gets `ESC[O` when its panel loses keyboard focus and `ESC[I` when it gains it.

### The session page (virtual clock)

- A session in a scenario's `sessions` may carry `"terminal": {"hosted": true, "terminal": ID}` or `{"hosted": false,
  "runs_in": string, "capture": {"sha256", "lines": [string]}}` (a terminal the hub doesn't host: where it runs, and a
  captured screen of it the surface *could* draw).
- **`{"call": "session_page", "at", "session", "panel"}`** → `{"tabs": [{"tab": "line" | "asks" | "checks" | "terminal", …}]}`:
  the session's page opens in the panel.
- **`{"call": "tab", "at", "session", "tab"}`** → `{"tab", "hosted": bool, "drawn": [{"id", "kind", "text"}], "controls":
  [{"label"}]}`: what the tab draws at `at`: every item with its kind (`cells@1`, `text@1`, `image@1`, …) and its text (a cell
  grid's rows joined by newlines), and the controls it shows.

### The cells module (the registry)

`{"call": "registry"}` (#305) lists `cells` among `modules` in the `r2` and `full` build sets, and not in `core` or `r1`;
every array it owns is named `cells.…`. **`{"call": "module", "name"}`** → `{"module": {"name", "version", "depends_on": {name
→ {"range", "optional"}}, "registers": {"kinds": [string]}}}`; `cells` depends on `text`, not optional, and registers
`cells@1`. A document that needs the module declares `requires.modules.cells`; a build without it refuses it
(`outcome: "refused"`) with `module_missing` naming `cells` (#305).

**The cell grid's document form** (the tests' reading of the issue's Fields): an item `{"kind": "cells@1", "params": {"size":
{"cols", "rows", "cell": [px, px]}, "font": {"family": font role, "size", "fallback": [], "ligatures": false}, "palette":
{"fg", "bg": role, "ansi": [16 roles], "truecolor": true}, "frame": {"revision", "base": null, "cells": [cols × rows
objects {"g", "fg": "#rrggbb", "bg": "#rrggbb", "attrs": u16, "link": number (0 none)}], "attrs": [name], "cursor":
{"x", "y", "shape", "visible", "blink"}, "scroll": {"history", "offset"}, "links": {}, "images": [], "modes": {…}}}}`.

### The claim's citations (TypeScript)

`ClaimInput` (`@deepbuild/verdicts`) gains an optional **`cites?: Cite[]`**, `Cite = {kind: "file" | "line" | "test" | "run" |
"link" | "cell_grid" | "screen"; handle: string}`: what the claim's words cite. A `run` cite resolves when it is one of the
claim's `runs`. The validity gate, with no model, sends back a claim whose citations are only cell grids and captured
screens, since neither counts as evidence of an agent's state: its verdict is **INVALID** and a reason names each such
handle. A claim that also cites a run it can resolve isn't sent back for them, and the evidence its verdict counts is the
run's.

### Programs the tests run (Node on the PTY)

`terminal_open`'s `program` is `node <script> args…`: a **writer** (numbered lines as fast as the terminal takes them: line n
is 36 characters, `L` and eight digits, a space, 26 characters from n, then a newline, 37 bytes; 1,416,995 lines are 50 MiB;
it writes its progress to a file after every 2,000 lines); a **reader** (puts its terminal in raw mode, logs every byte it
reads to a file, can first write escapes and then wait, marking each in its log); and a **marker** program (10,000 lines, every
250th holding a marker). Their sources are in `helpers.ts`.

### Planted programs

Each reachable only through `planted` (a scenario's, or `serve`'s setup), only to prove a test fails on a wrong program;
every test runs its own and asserts that it fails, naming what the criterion says it names.

| Name | The wrong program | Test |
|---|---|---|
| `terminal_30_per_second` | the terminal applies at most 30 updates a second, merging the rest | AC1 |
| `osc52_replies_secret` | the host answers every OSC 52 query with the clipboard's text | AC2 |
| `osc52_replies_in_st_form` | the host answers an OSC 52 query ended by `ESC \` with an empty reply | AC2 |
| *(the engine without `cites`)* | a gate that counts a cell grid as evidence: the claim's PASS is kept | AC3 |
| `cells_a_frame_late` | the cell grid draws each patch a frame after the frame it should | AC4 |
| `terminal_drops_oldest` | a full stream drops its oldest chunks instead of blocking the program | AC5 |
| `video_shows_late` | the frames queued during a pause are shown when the panel resumes | AC6 |
| `video_drops_uncounted` | frames are dropped and their counter stays 0 | AC6 |
| `stream_to_record` | each line of a stream is written to the record as an event | AC6 |
| `router_follows_pointer` | keys go to the panel under the pointer | AC7 |
| `agent_raw_input_accepted` | a raw-input write from an agent's session is delivered | AC7 |
| `tab_draws_text` | the terminal tab draws the terminal's text as text items, outside the cell grid | AC8 |
| `tab_redraws_at_30hz` | the terminal tab redraws at most 30 times a second | AC8 |
| `tab_draws_capture` | a terminal tab for a terminal the hub doesn't host draws the captured screen | AC9 |

## Criteria to tests

IDs: AC1 … AC9, the issue's nine criteria in order. Each test's name starts with its ID; tests of the issue's scope that no
criterion names start with `SCOPE` and aren't claimed as criteria. Each test builds its failures as sentences naming what
failed, and runs its wrong program to show the same check fails on it.

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A terminal keeps up at 60 updates a second | `terminal.test.ts`: a recorded feed of 600 lines, one every 1/60 s, into a terminal panel: on the 120 Hz display every update is presented in its own frame, no earlier than it can be current and within one frame (8.33 ms + latch + check), none dropped, merged or late, the revisions chained (each `base` the one before), and the grid ends on the last 35 lines with the 565 before them as history; popped out onto the 60 Hz display, each update has a B frame to itself. Fails on `terminal_30_per_second`, naming the update. `budgets.test.ts`: wall time per update (600 less none) within 1000/60 ms on a reference Mac, INCONCLUSIVE elsewhere; the perf lane has `terminal-60hz` naming #402 |
| AC2 | OSC 52 with `?`, in each of its forms, gets no reply, and no byte of a planted secret reaches the program | `clipboard.test.ts`: a real program on a PTY writes 43 queries (two introducers `ESC ]` and the C1 OSC, seven selections `c p q s 0 cp` and none, three terminators BEL, `ESC \` and the C1 ST, and one form a byte at a time), 25 ms apart, marking each in its own log of everything it reads; the test clipboard holds a secret. Each form gets 0 bytes back, the secret (plain, base64, base64url, hex) is nowhere in the log or the grid's state, and a key you type afterwards does reach the program (the control: the log works). Fails on `osc52_replies_secret` (each form, and the secret), `osc52_replies_in_st_form` (that form, and no other). SCOPE: each query is one refused read on the terminal, and the program's clipboard writes list is empty |
| AC3 | A cell grid or a captured screen never counts as evidence of an agent's state; a claim that cites one alone goes back | `evidence.test.ts`: a claim whose requirement a passing run covers (a PASS uncited) and that cites a cell grid alone, a captured screen alone, or both is INVALID, a reason naming each handle; beside a run it resolves, the grid is not sent back and adds nothing to the evidence counted; uncited is as before; the recorded verdict (a real SQLite record) is INVALID naming the grid, the one beside a run PASS. Fails on a gate that counts the grid (the engine without `cites`: PASS, names nothing) and on a send-back that names nothing |
| AC4 | A cell grid fed by a busy terminal's changes keeps up at 60 updates a second | `cellgrid.test.ts`: 600 full-screen repaints (36-row patches) at 60 a second: each drawn in its own frame on A and on B (popped out), none dropped or late, the grid ends on the last repaint, every patch of 36 rows. Fails on `cells_a_frame_late`, naming the update. `budgets.test.ts`: per patch within 5% of a core at 60 a second (0.833 ms) on a reference Mac; the perf lane has `cell-grid-60hz` naming #402 |
| AC5 | Panel host stopped by SIGSTOP for 10 s while the program writes 50 MB of numbered lines: every line once and in order after resume, the program's writes blocked during the pause; a planted stream that drops its oldest chunks fails, naming the first missing line | `backpressure.test.ts`: the hub starts a panel host (a process of its own) and a program (50 MiB of numbered lines on a PTY, 1,416,995 lines); after 20,000 lines the host is stopped; at 2, 6 and 9.9 s of the pause the program's progress is the same number, short of the end, the stream drops 0 bytes and holds at most 16 MiB (the hub answers `stream_stats` while the host is stopped); the host is continued, the program finishes, the stream drains, and all 1,416,995 lines are read back from the grid (history and screen), each once and in order, the screen showing the last 35 and an empty row. Fails on `terminal_drops_oldest`: the program isn't blocked, bytes are dropped, and the check names the first missing line |
| AC6 | A 30 fps video stream to a panel paused for 1 s drops and counts 30 frames and shows none late; a stream of 10,000 lines holding a planted marker leaves no event in the record carrying the marker | `streams.test.ts`: a 30 fps source from 5 s to 20 s, the panel paused over `[10 s + 1 ms, 11 s + 1 ms)`: the stream drops exactly frames 152 to 181, counts 30, shows no dropped frame, and shows every other frame within one frame of its time; fails on `video_shows_late` (naming the frame) and `video_drops_uncounted`. Then 10,000 lines (every 250th holding the marker) through a real terminal against a record the test made: the 40 marked lines reach the grid, the stream dropped nothing, the record is intact (the event the test put there is still there), and no event carries the marker in any column; fails on `stream_to_record`, naming the event. SCOPE: a sound stream drops and counts the same; only the panels a stream was opened for read it |
| AC7 | Two terminal panels, focus in A: 100 keys from the seam's test backend reach only A's program, also with the pointer over B; a raw-input write from an agent's session is refused, naming the writer; a router that sends keys to the panel under the pointer fails, naming B | `input.test.ts`: two panels, each a terminal with a reader program; your click gives A focus; 100 keys (press and release each), the pointer in no panel for 40, over A for 30 and over B for 30: every reply says `reached: ["panel:A"]`, A's program reads exactly the 100 keys in order, B's reads nothing, focus stays in A. Fails on `router_follows_pointer`, naming B. A write from session `sess-alpha` is refused naming `sess-alpha` and A's program reads none of it; fails on `agent_raw_input_accepted`, naming the writer. SCOPE: press, repeat and release, text, paste, mouse, focus and resize reach a program as their escapes say |
| AC8 | A session's page gains its terminal tab beside the line, asks and checks tabs; fed through the stream, the tab draws it through the cell grid and keeps up at 60 updates a second; a tab that draws the terminal's text outside the cell grid fails, naming the tab | `session.test.ts`: the page of a session with a hosted terminal has `line`, `asks`, `checks` in order and one `terminal` tab; fed 300 lines at 60 a second, the tab's last lines are in a `cells@1` item and in no other kind of item, and every update is presented in its frame on A. Fails on `tab_draws_text` (the failure begins "the terminal tab draws the terminal's text … outside the cell grid") and `tab_redraws_at_30hz` (naming the update). `budgets.test.ts`: per update through the tab within 1000/60 ms on a reference Mac. SCOPE: the status distance |
| AC9 | A session started in a terminal the hub doesn't host shows, in its terminal tab, only the line naming where it runs, with Open; a tab that draws a captured screen fails, naming the tab | `session.test.ts`: beta's terminal tab says where it runs, has Open, and draws no `cells@1`, `image@1` or `screen` item and none of the other terminal's captured text. Fails on `tab_draws_capture` ("the terminal tab draws a captured screen of the other terminal …") |

SCOPE tests (not criteria): `cellgrid.test.ts` reads the cell's grapheme, colors, attributes and link, the cursor, scroll
history, links, modes, title, cwd, progress and bell from a terminal's escapes, the alternate screen, a patch of one row,
and that the grid holds no selection; `session.test.ts` reads the palette rule (a terminal's color inside the status
distance of the look's `fail` color is drawn as the nearest allowed color on a session's page, and as asked in a plug-in's
panel); `registry.test.ts` reads the `cells` module in the build sets, on `text`, drawing a frame, refused by `core` and `r1`
with `module_missing`, and its fields checked (a size past u16, 15 ANSI roles, a frame that isn't cols × rows, a status role
in the palette).

The proof line ("terminal timings from the spike and the panel, the clipboard escape answered with nothing, and a claim
citing a cell grid sent back") is `budgets.test.ts` and its perf-lane tasks, `clipboard.test.ts` and `evidence.test.ts`.

## Readings where the issue and design leave a choice

- **Two modes of one binary.** The panel host, the stream, the PTY and the hub's record run in the app and the hub; a
  test can't drive them headless on a controlled clock and also stop them with a signal. `deep-show run` plays the hub's
  canvas side and its window on a virtual clock (#393, #400); `deep-show serve` is its long-lived form on the wall clock for
  what only real processes show (SIGSTOP, a PTY, bytes on a program's stdin, a record). No reading is INCONCLUSIVE for want
  of a GUI.
- **"A busy terminal's changes" and "60 updates a second"** are read as one update every 1/60 s from a recorded feed
  (AC1: one line each; AC4: a full repaint each), a virtual-clock reading of "keeps up" in the style of #96's patches and
  #401's bound values: each update presented in the first frame whose latch is at or after it (plus the checker's
  0.5 ms), within one frame of that. The wall-time half is the cost of an update (600 less none), as #401 and #96 time
  patches. "Under 5% of a core at 60 patches a second" (the cell grid's Cost) is AC4's wall limit.
- **A terminal panel is a plug-in's panel** with the new `cells` element and `raw_input` (the dry run the design's
  "blocks for plug-ins that host something live" came from: an extension hosting the agents' terminals in tabs).
- **"Each of its forms"** of OSC 52 with `?` is read as the introducers (ESC ], C1 OSC), the selections (`c p q s 0`, two
  at once, none) and the terminators (BEL, ESC \, C1 ST), plus a query split across writes. A program "gets no reply" when
  it reads no byte for any of them.
- **"A secret planted on the clipboard"** is a string on `serve`'s test clipboard; no test touches the system's. The
  secret must reach the program in no shape (plain, base64, base64url, hex) or the grid's state.
- **"The program's writes blocked"** is read as its progress not moving over the last 8 s of a 10 s pause, short of the end,
  with the stream holding at most 16 MiB (its buffer) and dropping nothing; the PTY's own buffer lets a little through in
  the first seconds. **"Every line once and in order"** is read by reading every row of the grid back, history and screen,
  so the grid keeps `history` ≥ the lines written (the test asks for `history: lines + 100`).
- **"Drops and counts 30 frames"**: the frames whose times fall in the pause (the pause starts 1 ms past a frame and ends 1
  ms past another, so no frame is on a boundary) are the 30 dropped; the stream's own counter says 30. **"Shows none late"**
  is read as every shown frame presented between its time and one display frame (8.33 ms) plus the latch lead and the
  checker's time after it.
- **"No event in the record carrying the marker"** is read over every column of every row of `events`, in a record the
  test made, which holds one event of its own that must still be there afterwards. The record is a real SQLite file;
  how `deep-show` writes to it (a dependency or the hub's socket) is the implementer's. A stream written to it fails.
- **"The input seam's test backend"** is the `seam` call; "keyboard focus in A" is your click in A (a serial and focus,
  #401); "the pointer over B" is `pointer`. A key is a press and a release, 100 of each.
- **"A raw-input write from an agent's session"** is `raw_input` with `by: {session}`; "the writer" is the session's ID, which
  the refusal's `writer` contains.
- **"A router that sends keys to the panel under the pointer fails, naming B"**: the failure sentence names `panel:B` (the
  receiver `seam` reports) and B's program.
- **"Cites one alone"** is read as the claim's `cites` holding only cell grids and captured screens; the gate is the
  validity gate (Claim: "every file, line, test, run or link the claim cites resolves"), whose send-back is a verdict
  INVALID (never PASS; invariant 2) whose reasons name each handle. No handle format is prescribed.
- **The terminal tab** is the page's fourth tab, `terminal`, after the three R1 ships; a session whose terminal the hub
  doesn't host still has the tab, showing where it runs. "Draws through the cell grid" is: the terminal's last lines are the
  text of a `cells@1` item and of no item of another kind. "Only the line naming where it runs, with Open" is: the text drawn
  contains where it runs, no cell grid, image or screen item, none of the captured screen's text, and a control labelled Open.
  "Naming the tab" is the failure's own sentence, which begins with the tab's name as the reply names it.
- **Status distance** is OKLab Euclidean distance against the clean look's `min_distance` (0.10) from every one of its
  status colors; "the nearest allowed" is read as within 0.2 of the color asked.
- **Titles, cwd, progress and bells** are read from OSC 2, OSC 7, OSC 9;4 (progress state 1 and a percent) and BEL.
- **The perf-lane tasks** are `terminal-60hz` and `cell-grid-60hz`; only their ids, a command and the #402 reason are read
  (`scripts/benchmark.mjs`'s `validateBudgets` against the merge base's file, as #401's AC8).

## Not tested, and why

- Recordings played in a cell grid (`play`, R6, "recordings played in films") and a grid a piece's logic writes (R6): the
  issue's Fields list `play`, but no criterion names it and the module's logic grid lands with the logic module.
- The terminal's cell grid on the GPU (one instanced glyph batch, one draw per atlas page): the cost sentence has no
  criterion; the spike in the gpui-kit app (a spike "moved from #60") is a measurement, whose numbers are the perf lane's.
- A terminal in a hosted session surviving the app quitting or the hub restarting (the supervisor's host process, #18/#25's
  start from the app): no criterion.
- The device bridge, sound output and the gesture gate (the trusted ring's, #401).
- A snapshot of a stream saved as evidence (design: Stream): no criterion names it.
- Selection and copy (the app's, session state) beyond the grid holding none.

## The Oracle lane

The issue names no upstream test; the stream, raw-input and terminal rules are this design's own, so nothing upstream is
ported and these tests are the local proof for every criterion.

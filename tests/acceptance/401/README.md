# Acceptance tests for #401: the trusted ring for panels, keymaps, gesture serials, placement and freshness

Written first, from issue #401 (its scope, its Bound value, Input router and Band fields, its ten acceptance criteria,
its proof line and the comment handing over #96's `serial_ring`), the design sections it links and those they lean
on, and base commit `c733840f` ("Merge pull request #794 from windoliver/claude/issue-777-47bdc6"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: the `deep.startSession` sketch (363: "only your Send starts one: a plug-in's call waits
  as a draft in the box until you send it"); Starting a session from the app (409); Blocks for plug-ins that do real
  work (489–507): Source and reading (494: "The hub makes every call … An answer served from the cache keeps the as-of
  time of the call that fetched it, and a failed call makes no reading, so a value bound to it grays with its age
  once it's past its freshness. Panels and actions never call the network themselves"), Action (500: change and send
  actions), Send (502), Replay and a clock, for tests (506), Panels, more fully (507: ⌘K commands, "a panel journey
  drives a panel headless"); Blocks for plug-ins that host something live: Raw input (537: "from a panel you've
  focused … It comes only from you") and Device bridge (538: "never gives it a gesture serial"); Access (1023: "the
  clipboard, and a window of its own … each only after your gesture in its panel"; "the agent (the hub: the
  extension's words reach a session only as a draft until you click in its panel)"); Panels and devices (trusted
  ring) (1947): Panel (1961: "Focus moves, pop-outs, sound, clipboard writes, toasts … need a gesture serial from your
  input in that panel. So do a plug-in's words into an agent session …, one send per serial; without one they wait as
  a draft in the session's box, marked with the plug-in's name and never over text you typed"; "It can never: Reach
  the network, run a program, move focus without your gesture, or draw outside its panel or over the question
  card"), Bound value in panels (1969), Keymap, placement, window (1977: "reserved chords are refused and conflicts are
  reported"; "verbs that never move what you placed"; "It can never: Bind a chord that sends, spends or answers"),
  Stream and raw input (1989); the threat rows Sessions DeepBuild starts (2365) and A plug-in's UI posing as the app
  (2383: "its toasts show only right after your gesture there"; "A panel script gets an empty gpui-shell policy, so it
  has no network or process access of its own"); the budget rules (2395–2420: per-task budgets against the merge
  base, five runs after warm-up, the margin, the two reference Macs, INCONCLUSIVE elsewhere); Dogfooding (~2518) and
  Tests written first (2549).
- `docs/canvas-primitives.md`: Conventions (7–100: handles, honest numbers); Band (771); Question card (785: "Toasts
  hide while it shows"); Input router, focus and gesture serial (799: `serial_ring[writer]`, `token: {serial, writer,
  kind, expires ≤ 30 s}`, `escape_chord`, `reserved_chords`; "Focus moves only by your input, or by a token from a
  recent serial"; "It can never: Feed an unfocused panel; accept another writer's serial; move focus on a timer; let
  an agent type; let a panel block the escape chord"); Panel runtime and panel host (877: "policy: empty plus
  DeepBuild's modules"; "It can never: Reach a GPU API, the network or a program; move focus without a fresh
  serial"); Window and display placement (891: "Cost: A pop-out in under 300 ms"); Frame clock (731: "the host time at
  which a bound value on screen goes stale or an age it shows ticks"); Bound value (2138: "A value goes stale when the
  frame's pinned host time passes its as-of time plus `stale_after` … A stale value grays out and shows its age.
  Updates coalesce to once per frame"); Held reading (2160); Sheet `sheet@1` (2352); Cell grid `cells@1` (2369:
  clipboard writes shown, reads refused).
- At the base: AGENTS.md; `tests/acceptance/400/` (README, helpers, the Driver and `deep-show run`'s displays,
  `pop_out`, `windows` and `card`), `96/` (the virtual display clock, the budget judge and the perf-lane check),
  `383/` (`input` and its serial), `392/` (bound values: `stale`, `age`, the as-of), `393/`, `394/`, `326/panels/`
  (`panel@1`'s install check in `crates/deep-replica/src/kit.rs`), `237/` (the load check); `crates/deep-show/src`
  (`main.rs`'s scenario and calls, `input.rs`, `placement.rs`'s `pop_out`, `ask.rs`, `hub.rs`'s record readings),
  `crates/deep-canvas/src/scope.rs` and `show.rs` (bound values in documents), `packages/extension-host/src/host.ts`
  (`deep.fetch` through the host), `scripts/lanes.mjs`, `benchmarks/budgets.json`.

What the base already does and these tests don't credit: `deep-show run` presents documents in panels, gives each
`input` a serial, and (#400) refuses a `pop_out` with no serial or with a serial of an input in another panel, on two
displays on the virtual clock; `panel@1`'s install check (#326) refuses a panel package whose script source names a
network or process call. There is no plug-in install, no panel script run by the hub, no serial age, no token spent
by a send, no session box or drafts, no keymap, no placement verb, no recorded source, and no bound value in a
panel's element tree.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/401 --no-file-parallelism
npx tsc -p tests/acceptance/401/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds `deep-show` once with `cargo build --locked --bin deep-show` in the checkout, copies it out of
`target/debug` into a temporary folder, and fails each of its tests when the build fails. Each test writes into its
own temporary folder and deletes it. The tests use node built-ins and vitest only. A run with `--root
tests/acceptance/401` may leave Vitest's cache in `tests/acceptance/401/node_modules/.vite` or a `.vitest` folder;
delete it. `scripts/lanes.mjs` needs `tests/acceptance/401/` in its one-at-a-time list beside `400/`, since the files
build a cargo binary and `budgets.test.ts` times budgets; this README is the instruction, and the implementer makes
that edit.

AC1's test starts one child process of its own, a local HTTP listener on an ephemeral port, and stops it by its PID.

Every test but AC8's wall-time pair is deterministic and runs on every platform: the scenarios run on the hub's
virtual display clock and read no wall time. AC8's two wall-time tests count only on a reference Mac (Mac15,7 or
Mac15,12) on mains power, Low Power Mode off, thermal state nominal and a 1-minute load no higher than its core count;
anywhere else they fail with a message starting `INCONCLUSIVE:`. They never pass, and never skip, on a reading they
can't trust.

`BASE-FAILURE.txt` is the run at the base (home paths redacted): all 15 tests fail. 14 fail because `deep-show run`
answers the scenario `{"ok": false, "code": "bad_input"}`: the base parser has no `install` call (or any of the calls
below). The perf-lane test fails because `benchmarks/budgets.json` has no `panel-bound-value` task. That is the
missing behavior, not a test mistake.

Nothing missing passes (invariant 2): a reply without a field a test reads fails the test naming the field; a run
that answers `bad_input`, exits non-zero or writes fewer lines than it read fails every test that drove it.

## The surface under test

The issue names panels, scripts, keymaps, serials, placement, sources, bound values, the session's box and drafts,
but no code API. So these tests extend the one binary that already plays the hub's canvas side and its window for
tests, `deep-show run` (#393, #96, #383, #400), with the smallest set of fields and calls they need, in its own
style. No new binary. The issue's comment puts the serial ring on the hub side in `deep-show`; this is that side.

### The JSON-lines convention and the scenario

#393's and #400's, unchanged: one JSON scenario per stdin line, one JSON object out per line, then exit 0; a line that
isn't JSON, lacks a required field or names an unknown `planted` value answers `{"ok": false, "code": "bad_input"}`;
a scenario that runs answers `{"ok": true, "replies": [Reply]}`, one per call, in order. Every scenario here has
#400's `displays` (A, the 120 Hz main display; B, 60 Hz), `clock: {lead, check}`, `window: [1200, 700]`, `panels:
{ID: {rect}}` (window px), `sessions` (alpha), `processes`, `evidence`, optional `card` (#400's ask with `size` and
`at`) and optional `planted`; every call carries `at` (flicks) and calls arrive in `at` order. A panel here holds no
document: a plug-in's install claims it by ID and draws its element tree in it.

Times: flicks (705,600,000 a second). A recorded source's call is answered at its call's `at`, with no latency. The
test clock's 10:00:00 is flick 60 s (`fresh.test.ts`); the tests read as-of times and ages in flicks.

### Plug-ins: the `install` call

**`{"call": "install", "at", "plugin": name, "manifest": Manifest}`** → `{"installed": true, …}`, or a refusal
`{"code": string, "chord": chord}` (with `installed` absent or false) for a keymap the check refuses. Any other
field in either reply is the implementer's. The helpers install each test's set-up plug-ins at flicks 1, 2, 3 …
and fail the test unless each answers `installed: true`.

```json
Manifest: {
  "panels": {panel ID: {"tree": [Element], "script"?: Script, "raw_input"?: bool}},
  "sources"?: {source ID: {"fresh_for": flicks, "replay": [Answer], "then"?: Answer}},
  "actions"?: {action ID: {"kind": "change" | "send" | "spend"}},
  "keymap"?: [{"chord": string, "context": string, "command": {"action": action ID} | {"core": "session.send" | "ask.answer"}}]
}
Element: {"id", "component": "text", "text"?: string, "bind"?: Bind}
       | {"id", "component": "sheet", "cells": [{"id", "text"?: string, "bind"?: Bind}]}
       | {"id", "component": "chart", "label": {"bind": Bind}}
Bind:    the issue's Bound value fields: {"source": "reading:<source ID>", "select", "format": {"unit", "precision",
         "notation"}, "show": {"source", "as_of"}, "stale_after": flicks, "missing"}
Answer:  {"value": number, "unit": string} | {"fails": string}
Script:  {"timers"?: [{"first": flicks, "every": flicks, "until"?: flicks, "do": [Op]}], "on_read_failed"?: [Op]}
Op:      {"op": "fetch", "url"} | {"op": "run", "argv": [string]} | {"op": "focus"} | {"op": "pop_out", "display": uuid}
       | {"op": "clipboard", "text"} | {"op": "toast", "text"} | {"op": "read", "source": source ID}
       | {"op": "say", "session", "kinds": ["steer" | "follow_up" | "prompt"], "text"} | {"op": "place", "piece": panel ID, "rect": [x, y, w, h]}
```

- A panel's **script** is the recorded behaviour of a panel script: what it asks of its host, and when. A timer runs
  its ops at `first`, `first + every`, … up to `until` (inclusive) or the scenario's end. `on_read_failed` runs each
  time one of the panel's `read`s fails. A timer callback carries no serial of its own; whether an op is let through
  is the host's decision (Input router, Panel).
- `fetch` and `run` are the script reaching the network or a program itself; the panel host's policy is empty, so
  they are refused and nothing is fetched or run. `read` asks the hub to call one of the plug-in's sources (Source
  and reading: the hub makes every call): the n-th call gets `replay[n]`, and every call past the list gets `then`
  (no `then`: the last answer again). A `{"fails"}` answer is a failed call: it makes no reading. A source's reading
  handle is `reading:<source ID>`.
- `focus`, `pop_out`, `clipboard`, `toast`, `say` and `place` each need a fresh serial of your input in that panel:
  an input you gave the panel (an `input` call naming it) less than 30 s before (the token's `expires ≤ 30 s`). One
  serial lets any number of `focus`, `pop_out`, `clipboard`, `toast` and `place` ops through while fresh, but **one
  `say` per serial**. A `say`
  without one waits as a draft in the session's box. Each time a `say` runs it uses the next of `kinds`, in turn.
- `place` is the placement verb `put`: the piece (a panel) at `rect` in the main window. A panel's script may place
  any piece; a piece you placed doesn't move.

### Calls and replies

- **`{"call": "attempts", "at", "panel"}`** → `{"attempts": [{"at", "op", "outcome", "serial": n | null}]}`: every op
  the panel's script tried up to `at`, in order: `at` the flick it ran, `op` its name, `serial` the serial it spent or
  carried (null for none). `outcome`: `done` (let through), `refused`, `failed` (a `read` whose call failed),
  `sent` (a `say` that reached the session) or `draft` (a `say` that waits in the box). A `read` that got an answer
  is `done`.
- **`input`** (#383's) with a `key` event `{"type": "key", "key", "mods": []}`: its reply gains `"reached":
  [receiver]`, every receiver the key went to, each `"shell"` or `"panel:<ID>"`. A click (`down`) on a panel gives it
  keyboard focus and its reply's `serial` is the serial of your input in that panel.
- **`{"call": "focus", "at"}`** → `{"kb_focus": panel ID | null}`.
- **`{"call": "clipboard", "at"}`** → `{"clipboard": {"text", …} | null}`.
- **`{"call": "toasts", "at"}`** → `{"toasts": [{"plugin", "text", "display": uuid, "rect": [x, y, w, h], "shown":
  bool}]}`: every plug-in toast made up to `at` and not yet gone, and whether it is drawn at `at`.
- **`{"call": "place", "at", "piece", "rect", "serial"? | "session"?}`**: with `serial`, your drag of that piece
  (the serial of your input in it); with `session`, an agent's suggestion. Reply `{"piece": {…}}` when placed, or a
  refusal `{"code"}`. A placed piece's `rect` is in the main window's px.
- **`{"call": "pieces", "at"}`** → `{"pieces": [{"piece", "rect", "placed_by": "you" | "plugin" | "suggestion" |
  "default"}]}`.
- **`{"call": "drawn", "at", "panel"}`** → `{"vsync": flicks, "bound": [{"element", "text", "stale": bool, "age":
  flicks | null, "as_of": flicks | null, "source"}]}`: the frame on screen in the panel at `at` (the newest presented
  at or before it; `vsync` its presentation) and each bound value as that frame draws it. `element` is the text's ID,
  `<sheet ID>/<cell ID>` for a sheet cell, `<chart ID>/label` for a chart's label. `text` is what is drawn; `stale`
  whether it is drawn greyed; `age` the frame's pinned time less the reading's as-of time (null while live);
  `as_of` the reading's as-of time; `source` the handle.
- **`{"call": "reading", "at", "source"}`** → `{"reading": {"value", "unit", "as_of", "source"} | null, "calls":
  [{"at", "outcome": "answered" | "failed"}]}`: the source's reading at `at`, and every call the hub made to it.
- **`{"call": "type", "at", "session", "text"}`**: your typing of `text` into that session's box (hardware keys).
- **`{"call": "box", "at", "session"}`** → `{"box": {"typed": string, "drafts": [{"text", "plugin", "panel", …}]}}`:
  the text you typed, and the drafts beside it, each marked with the plug-in and panel it came from.
- **`{"call": "turns", "at", "session"}`** → `{"turns": [{"at", "kind", "text", "by": {"plugin", "panel"} | "you"}]}`:
  every word delivered into the session up to `at`. The test session is idle and ends each turn at once, so every
  delivery starts a turn of its own; "no turn starts, nothing is delivered" is an empty list.
- **`{"call": "keymap", "at"}`** → `{"bindings": [{"plugin", "chord", "context", "command"}], "conflicts": [{"chord",
  "context", "plugins": [name]}]}`.
- **`pop_out`** and **`windows`** (#400's) are unchanged, except that the serial must be under 30 s old.

Chords are written `mod+…+key` in lower case (`cmd+k`, `cmd+shift+p`); the escape chord is `escape`.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; every test runs its own and
asserts that it fails, naming what the criterion says it names.

| Name | The wrong program | Test |
|---|---|---|
| `panel_policy_open` | the panel host lets a script's `fetch` reach the network and its `run` start the program | AC1 |
| `toasts_ignore_card` | plug-in toasts keep showing while the question card does | AC2 |
| `script_ops_need_no_serial` | a script's focus, pop-out and clipboard write go through with no serial | AC3 |
| `placement_moves_yours` | a placement verb or a suggestion moves any piece, yours too | AC4 |
| `refresh_restamps_cached` | after a failed call the source serves its cached answer with the call's time as its as-of | AC5 |
| `sends_without_serial` | a panel's `say` is delivered with no serial | AC6 |
| `serial_carries_many_sends` | a fresh serial lets every `say` through until it expires | AC7 |
| `bound_value_a_frame_late` | a reading shows a frame after the frame it should | AC8 |
| `keymap_unchecked` | install takes any keymap as it is | AC9 |
| `conflicts_unreported` | two bindings of one chord in one context install with no conflict reported | AC9 |
| `focused_panel_takes_escape` | every key, the escape chord too, goes to the focused panel alone | AC9 |
| `accepts_any_ring_serial` | a pop-out takes any serial in the writer's ring, however old and from whichever of its panels | AC10 |

## Criteria to tests

Each test's name starts with its ID. Each builds its criterion's failures as sentences naming what failed, and runs
its wrong program to show the same check fails on it.

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A panel script can't fetch or run a program | `ring.test.ts`: the panel `p` of `curious`, holding a fresh serial of your click, fetches `http://127.0.0.1:<port>/from-panel` (a listener of the test's) and runs `node -e` writing a marker file, once a second for 3 s: all 3 of each are `refused`, the listener gets no request and the marker doesn't exist; its `read` of its declared source through the hub is `done`. Fails on: `panel_policy_open` (the listener's request and the marker); a host that refuses the hub's `read` too |
| AC2 | A plug-in's toast can't cover the question card | `ring.test.ts`: after your click in `notifier`'s panel its toast "build finished" shows (before the ask); with the ask's card presented from 5 s, at 8.5, 12.5 and 18.5 s the card is presented or armed and no plug-in toast is shown, including those asked after your second click during the card. Fails on: `toasts_ignore_card`, naming the toast; a card never presented |
| AC3 | A focus request, pop-out or clipboard write without a fresh gesture serial from your input is refused, checked by a fixture that tries on a timer | `ring.test.ts`: `pesky`'s panel `p` asks for focus, a pop-out onto B and a clipboard write every 2 s; your only input until 69.5 s is a click in another plug-in's panel `q`. All 34 tries of each before then are `refused`; at 60 s focus is not on `p`, `p` has no window, the clipboard doesn't hold pesky's text. The tick at 70 s, 0.5 s after your click in `p`, lets all three through (focus on `p`, `p` popped out onto B, the clipboard holding pesky's text). Fails on: `script_ops_need_no_serial`, naming each op; a host that takes your serial from `q`; one that refuses all, serial or not |
| AC4 | No plug-in or suggestion moves a piece you placed | `ring.test.ts`: you place `x` (your click's serial) in the bottom-right slot; `mover`, holding a fresh serial of your click in its own panel, puts `x` elsewhere and its own `m` in the bottom-left slot; alpha's suggestion puts `x` elsewhere and is refused. `x` stays where you placed it, `placed_by: you`; `m` is where its verb put it. Fails on: `placement_moves_yours`, naming `x`; verbs that move nothing |
| AC5 | Freshness on three surfaces, with the planted refresh | `fresh.test.ts`: source `quotes` answers 182.40 USD at 10:00:00, fresh for 60 s, `http_503` on every later call (10:00:20 … 10:02:00, read every 20 s by the quote panel). The panel text `price`, the sheet cell `grid/price` and the chart label `trend/label`, each bound to it with `stale_after` 60 s, draw "182.40" live with as-of 10:00:00 one frame after 10:00:00, at 10:00:30 and at 10:00:59.999; greyed in the frame at 10:01:00 plus a frame, at 10:01:30 and at 10:02:00 plus a frame, each with `age` = its frame's time less 10:00:00, the last with an age of 2 minutes and a text showing it. After each failed call the reading's as-of is still 10:00:00, its value 182.40, and its calls are one `answered` then each `failed`. Fails on: `refresh_restamps_cached`, naming each of the three surfaces; a clock that never greys, one that greys early, one that drops the value or its as-of on a failed call |
| AC6 | The hour-long panel | `session.test.ts`: `uptime`'s panel `status` reads `api` every 30 s for an hour, every call failing, and its error handler sends "the API is down, fix it" to alpha, in turn as a steer, a follow-up and a prompt; you typed "also check why the nightly job was slow" into alpha's box first. 120 failed reads and 120 sends, all `draft`; alpha's turns are empty; the box's typed text is unchanged, and it holds exactly one draft, that text, marked plug-in `uptime`, panel `status`. Fails on: `sends_without_serial`, naming panel `status` and its 120 turns; a box that holds 120 drafts, or puts the draft over your text |
| AC7 | One click, one send; a host that lets one serial carry two sends fails, naming the serial | `session.test.ts`: the same panel reading every 10 s (sends at 10 … 60 s); your click at 25 s. The send at 30 s is `sent`, carrying your click's serial, and is the session's only turn; the sends at 40 and 50 s (the same click's serial, under 30 s old) are `draft`, and the box holds the panel's draft. Fails on: `serial_carries_many_sends`, naming the serial |
| AC8 | Budgets: a bound value updates within one frame of its reading, and a pop-out opens in under 300 ms, on the reference Mac in the local preflight, against the merge base | `budgets.test.ts`: (1) on the virtual clock, ten readings 2 s apart: 1 ms before each, no surface shows its price; one frame (8.33 ms) plus the latch lead after it lands, the panel, the sheet cell and the chart label all show it, in a frame no later than that. Fails on: `bound_value_a_frame_late`, naming each surface. (2) `benchmarks/budgets.json` has tasks `panel-bound-value` and `panel-pop-out`, each naming #401 in its `initialReason`, valid against the merge base's file (`scripts/benchmark.mjs`'s `validateBudgets`), as #96's AC12. (3) wall time on the reference Mac, five runs after a warm-up: 600 readings on three surfaces less the same run with none, per reading, under 1000/120 ms; six pop-outs onto B less the same run with none, per pop-out, under 300 ms |
| AC9 | Keymap refusals, the ⌘K conflict, and escape | `keymap.test.ts`: five plug-ins, each with a harmless ⌘R beside one binding of `cmd+enter` to `session.send`, `cmd+shift+p` to its send action, `cmd+b` to its spend action, `cmd+y` to `ask.answer`, or `escape` to its change action, are each refused at install naming exactly that chord, and none of their bindings is in the keymap (fails on `keymap_unchecked`, naming each chord). `palette-a` and `palette-b` both bind `cmd+k` in context `panel` (and `palette-a` also `cmd+j`, `palette-c` `cmd+k` in `sheet`): all install, and the keymap reports exactly one conflict, `cmd+k` in `panel`, naming `palette-a` and `palette-b` (fails on `conflicts_unreported`; a check that flags `cmd+j` or the other context). `term`'s panel takes raw input; after your click it has focus, the key k reaches `panel:t`, and the escape chord reaches `shell` (fails on `focused_panel_takes_escape`) |
| AC10 | Serial age and panel; a router that accepts any serial in the writer's ring fails, naming the serial | `serial.test.ts`: `x` and `y` are two panels of one plug-in. A pop-out of `y` onto B with y's click's serial 31 s old opens nothing; with x's click's serial (y clicked since, so both serials are in the writer's ring) opens nothing; with y's click's serial 29 s old opens y's window. Fails on: `accepts_any_ring_serial`, naming the 31 s old serial and x's serial |

The proof line ("a plug-in that tries each forbidden thing, the hour-long panel on a controlled clock, and the
freshness fixture on three surfaces") is `ring.test.ts` (AC1–AC4, with AC3's timer and AC10's and AC9's plug-ins),
`session.test.ts`'s hour (AC6) and `fresh.test.ts` (AC5).

## Readings where the issue and design leave a choice

- **One binary standing in for the panel host, the router and the box.** The panel host, the shell's keymap and the
  session's box run in the app and the hub, which a test can't drive headless and on a controlled clock for an hour;
  `deep-show run` already plays the hub's canvas side, its input router and its windows for tests (#383, #400), so
  plug-ins, their panels and the box are its scenario's calls. No reading is INCONCLUSIVE for want of a GUI.
- **A panel script as data.** The design's panel scripts are gpui-shell JavaScript; `deep-show` runs no script engine,
  and #326's `panel@1` already reads the script source at install. Here the script is its recorded behaviour, the ops
  it asks of its host and when, so the host's decisions (policy, serial, draft) are what is tested, against real
  observables (a listener, a marker file, focus, windows, the clipboard, turns). A host that ran real scripts would
  meet the same contract.
- **"Fetch".** In AC1 a fetch is the script reaching the network itself (refused: the empty policy). In AC6 "a test
  panel whose fetch fails" is read as the panel's read of its declared source through the hub, which fails: panels
  never call the network themselves (Source and reading).
- **A fresh serial** is one of your input in that panel under 30 s old (the token's `expires ≤ 30 s`), so a 29 s old
  serial opens and a 31 s old one doesn't (AC10). A click in a panel lets that panel's later ops through while its
  serial is fresh ("by a token from a recent serial"); a timer callback mints none, and your input in another panel
  counts for neither (AC3). One `say` spends a serial; other ops don't (the design says "one send per serial" only of
  words into a session).
- **AC7's cadence.** With "that panel" fetching every 30 s, no second send could fall inside the click's serial's
  30 s, so a host whose serial carries many sends couldn't be told apart; AC7 runs the same panel reading every 10 s.
  "The next send" is the first send after the click.
- **"Marked with the panel's name"** (the issue) and "marked with the plug-in's name" (the design): the draft carries
  both, and the tests read both. One draft: the box holds at most one draft per panel; a later send replaces it.
  "Beside the text you typed" is the box's `typed` unchanged and the draft in `drafts`.
- **"Starts 120 turns".** The test session is idle and ends each turn at once, so each delivered send (steer,
  follow-up or prompt) starts a turn; 120 failures in an hour (one at each 30 s from 30 s to 3,600 s) give 120.
- **"Can't cover the question card"** is read with Question card's "Toasts hide while it shows": no plug-in toast is
  drawn while the card is presented or armed. The toasts are allowed to show at all only after your gesture in the
  panel (Panel), so the control shows one before the ask.
- **"A piece you placed"** is a panel you put somewhere with your drag (`place` with your serial). The placement verb
  is `put` at a rect; "a suggestion" is an agent's `place` naming its session. A refusal and a no-op both count, as
  long as the piece stays.
- **Freshness.** 10:00:00 is flick 60 s of the scenario clock; as-of times and ages are read in flicks. "Live until
  10:01:00 and greyed from then" is read on frames: frames before 10:01:00 draw it live, and the frame on screen one
  frame (and the latch lead) after 10:01:00 draws it greyed. `age` is #392's: the frame's pinned time less the as-of.
  "An age of 2 minutes" in the text is read as `2` followed by `m`, `min`, `mins` or `minute(s)`; the value "182.40"
  is in the drawn text live and greyed. The planted refresh fails "naming each surface" by the surface's name in the
  failure.
- **Three surfaces** are three components of a plug-in's element tree (text, a sheet's cell, a chart's label), in
  three panels, each with the issue's Bound value fields; the issue's "sheet cell" is not `sheet@1` (whose cells show
  document handles) but a sheet component's cell in a panel.
- **Within one frame of its reading** (deterministic part): the frame on screen at the reading's time plus one A
  frame (8.33 ms) plus the 2 ms latch lead shows it, and none before the reading does. The wall-time part times the
  hub's work per reading on three surfaces against one 120 Hz frame, and a pop-out's work against 300 ms, each as a
  difference between two `deep-show run` scenarios (as #96 times patches); the perf-lane tasks' commands are the
  implementer's, and only their ids and the #401 reason are read.
- **"Naming the chord"** is the refusal's `chord` field; the refusal's `code` isn't read. A send is `session.send` or
  an action of kind `send`, a spend an action of kind `spend`, answering an ask `ask.answer`; the escape chord is
  refused whatever it is bound to. "One conflict reported naming both" is the `keymap` call's `conflicts`.
- **"A focused panel that handles that key"** is a panel that asks for raw input, focused by your click, which gets
  keys (the control: k reaches it); the escape chord must reach the shell, whether or not the panel sees it too.
- **The writer's ring.** A plug-in is one writer, so its two panels' serials share its ring (`serial_ring[writer]`);
  that is what makes "another panel's serial" a case a ring-wide check gets wrong.

## Not tested, and why

- Drag out and open by handle, and the clipboard never copying concealed content (scope): no criterion gives an
  observable, and no concealed field exists in the base to copy from.
- Sound, raw input beyond the escape chord, and the device bridge (scope's "sound … and raw input"): no criterion
  names them; AC3 names focus, pop-outs and clipboard writes only.
- Band's fields and "never draw outside its panel" (#326's AC6 and AC7 test drawing over the card in the app).
- `as_of: record` in a replayed film, `show`, `missing`, `select` other than `value`, `format` notations other than
  `fixed`: read only as given in the fixture.
- A draft sent by your Send, and a session started from the box (#18's and the app's).
- Patches written as you with a serial (`edit_as_you`, R6; the comment's hand-over to #98).

## The Oracle lane

The issue names no upstream test; the gesture-serial rules, drafts and freshness on panels are this design's own, so
nothing upstream is ported and these tests are the local proof for every criterion.

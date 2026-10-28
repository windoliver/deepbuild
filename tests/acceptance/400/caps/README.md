# Acceptance tests for #400's AC5: a window's caps when you leave it, the Mac is hot or you hide it

Written first, from issue #400 (its scope line "Each window is paced by its own display, remembered by display UUID,
and capped when you leave it, the Mac is hot, or you hide it", its Frame clock and scheduler fields and its fifth
criterion), the design sections it links, and base commit `e113a3e` ("Merge remote-tracking branch 'origin/main' into
claude/issue-400-implementation-568791"), by a job that never saw an implementation of this criterion; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

What was read:

- Issue #400, AC5: "A window you switch away from presents at most 30 Hz, every window at most 60 Hz while the Mac is
  hot, and a window you hide presents nothing and evaluates none of its sessions; a window that presents over its cap
  fails, naming the window and the cap".
- `docs/canvas-primitives.md`: Frame clock and scheduler (per window `caps: {inactive: 30 Hz, thermal: 60 Hz,
  hidden: 0}`; "At the latch it evaluates every session at the predicted presentation time"; "Each window is paced by
  its own display"; "It can never: Draw unasked; evaluate a hidden session; …"); Session ("A hidden session is neither
  evaluated nor called back"); Admission and latch ("It can never: … block `deep_show` on a hidden panel"); Frame
  callback and presentation feedback ("One callback per presented frame, only while visible"); Window and display
  placement.
- `docs/technical-design.md`: Dogfooding and Tests written first; the thermal state "nominal" and "fair" in the budget
  rules.
- At the base: AGENTS.md and the #400 suite, `tests/acceptance/400/` (README.md, helpers.ts, frames.test.ts,
  BASE-FAILURE.txt), whose `deep-show run` surface these tests build on.

What the base already does and these tests don't credit: `deep-show run` takes the #400 suite's `displays`, `clock:
{lead, check}`, `window`, `pop_out` and `windows`, and on the virtual clock presents x in the main window on A at
every vsync of A and y popped out onto B at every vsync of B while something new reaches each latch. Nothing caps a
window: there is no signal for you leaving a window, for the thermal state or for hiding a window, and the
`presented` reply reports no evaluations.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/400/caps --no-file-parallelism
npx tsc -p tests/acceptance/400/caps/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

The file imports the #400 suite's `../helpers.ts` (the build, the displays, the scenario, the reply parsers) and
doesn't change it. It builds `deep-show` once with `cargo build --locked --bin deep-show`, as that suite does, and
fails each test when the build fails. Each run writes into its own temporary evidence folder and deletes it. Delete
the Vitest cache a run leaves in `tests/acceptance/400/caps/node_modules/.vite` or `.vitest`. `scripts/lanes.mjs`
already runs `tests/acceptance/400/` one at a time, which holds this folder.

Everything is deterministic: the scenarios run on the hub's virtual display clock and read no wall time, the thermal
state is a call, not the Mac's own, and nothing draws pixels. `BASE-FAILURE.txt` is the run at the base (home paths
redacted): all 3 tests fail, each because `deep-show run` answers the scenario `{"ok": false, "code": "bad_input"}`
at its first AC5 call (`activate`, `thermal` or `hide_window`), after the #400 steps before it (scope, click,
pop-out, windows) ran. That is the missing surface, not a test mistake. The same scenario with no AC5 call runs at
the base and fails on the `presented` reply's missing `evaluations`; its frames are uncapped (24 in 200 ms on A, 12
on B in every phase), which the cap checks below fail, naming the window and the cap.

Nothing missing passes (invariant 2): a reply without a field the tests read fails the test naming the field; a
run that answers `bad_input`, exits non-zero or writes fewer lines than it read fails every test that drove it; a
signal answered with a `code` fails. No test skips, and none reads a real display or the real thermal state, so none
is INCONCLUSIVE.

## The surface under test

The #400 suite's (its README: The surface under test), unchanged, plus three calls, one field of the `presented`
reply and four `planted` names. Each call is a report from the window server or the OS on the virtual clock, in the
style of that suite's `move_window`. Every call carries `at` (flicks, 705,600,000 per second).

### Calls and replies

- **`{"call": "activate", "at", "window": ID | null}`**: the window server's report that this window became the key
  window, or with `null` that you switched to another app (no window of the app is key). A window **you switched
  away from** is one that was key when an `activate` named another window or `null`; it is inactive, capped at
  `inactive: 30 Hz`, until an `activate` names it again. Before any `activate`, no window is inactive (the #400
  suite's AC3 runs have none, and both its windows present at their displays' rates). Whether a window that was
  never key is capped isn't read. Reply: an object without `code`; nothing else is read.
- **`{"call": "thermal", "at", "state": "nominal" | "fair" | "serious" | "critical"}`**: the OS's thermal state
  (macOS `ProcessInfo.thermalState`). The Mac **is hot** at `serious` and `critical`: every window is capped at
  `thermal: 60 Hz` until a `nominal` state. The tests send only `serious` and `nominal`; how `fair` caps isn't read.
  Before any `thermal`, the state is `nominal`. Reply: an object without `code`.
- **`{"call": "hide_window", "at", "window": ID, "hidden": bool}`**: the window server's report that you hid that
  window (`true`: minimized, or hidden with the app) or showed it again (`false`). While hidden it is capped at
  `hidden: 0`: it presents no frame and none of its sessions is evaluated; once shown, it presents again. Reply: an
  object without `code`.
- **`presented`** (the #400 suite's `{"call": "presented", "at", "panel"}`): beside `frames`, the reply gains
  `evaluations`, every evaluation of a session drawn in that panel up to `at`, in order:

  ```json
  {"frames": [Frame], "evaluations": [{"at": flicks, "session": ID, "window": ID}]}
  ```

  `at` is the predicted presentation time the session was evaluated for (Frame clock: "At the latch it evaluates
  every session at the predicted presentation time"), so each presented frame has an evaluation with `at` equal to
  its `vsync`; `window` is the window the panel was in. An evaluation made for no frame is still listed.

A cap bounds a window's frames to its rate: no two frames of a window capped at 30 Hz are less than 1/30 s apart
(4 vsyncs of A, 2 of B), and no two of a window capped at 60 Hz less than 1/60 s apart. The caps take the lowest
that applies. A capped window still presents only at vsyncs of its own display, and on demand: with something new at
every latch it presents at its cap.

### Planted programs

Each reachable only through the scenario's `planted`, only to prove a test fails on a wrong program; every test runs
its own and asserts that it fails, naming the window and the cap.

| Name | The wrong program | Test |
|---|---|---|
| `ignores_inactive_cap` | a window you switched away from keeps presenting at its display's rate | inactive |
| `ignores_thermal_cap` | the thermal state changes no window's rate | thermal |
| `presents_hidden` | a hidden window keeps presenting at its display's rate (and evaluating its sessions) | hidden |
| `evaluates_hidden` | a hidden window presents nothing, but its sessions are still evaluated at its display's latches | hidden |

## Criteria to tests

`caps.test.ts`. Each test's name carries `#400.AC5` and a label (`inactive`, `thermal`, `hidden`). Every run is the
#400 suite's AC3 layout: you click y and pop it out onto B (60 Hz, vsyncs 3 ms out of A's phase); x stays in the
main window on A (120 Hz). From s0, alpha patches each board every 4 ms (a new checked revision before every latch of
either display), through 300 ms phases; each signal is made at the start of a phase, and each phase's frames are read
over 200 ms, half open, from 50 ms into it. An uncapped window presents exactly its display's rate there (24 frames
on A, 12 on B); a capped one has no two frames closer than the cap's period and presents at the cap, one frame short
at most (5 or 6 at 30 Hz, 11 or 12 at 60 Hz); each frame is at a vsync of its own display, paced by it, in its own
window. Each failure is a sentence naming the window ID and, when over a cap, the cap (`inactive: 30 Hz`, `thermal:
60 Hz`, `hidden: 0`). Every patch outside a hidden window's phase applies.

| Label | Run, and what it reads | Fails on |
|---|---|---|
| inactive | Phase 1: `activate` the main window: x at A's rate. 2: `activate` y (you switch from the main window to y): x at most 30 Hz on A; y, now key, at B's rate. 3: `activate null` (you switch to another app): x and y at most 30 Hz, y on a 60 Hz display. 4: `activate` the main window: x at A's rate again. | `ignores_inactive_cap`, naming the main window and `inactive: 30 Hz`; and a cap never lifted, one that stops presenting, one at the wrong display's vsyncs |
| thermal | Phase 0: x at A's rate, y at B's. 1: `thermal serious`: x and y at most 60 Hz (x halved on A; y on B unchanged). 2: `thermal nominal`: x and y at their displays' rates again. | `ignores_thermal_cap`, naming the main window and `thermal: 60 Hz`; and a cap never lifted, one that drops below 60 Hz on A |
| hidden | Phase 0: y at B's rate, each of its frames with an evaluation of its sessions for that vsync. 1: `hide_window` y: from a frame of B after the hide until y is shown, y presents no frame and has no evaluation; x keeps A's rate. 2: `hide_window` y `false`: y at B's rate again, each frame evaluated. | `presents_hidden` and `evaluates_hidden`, each naming y's window and `hidden: 0`; and an evaluation list that is empty or made up (the visible frames must each have one) |

The returns ("when the signal ends, the window returns to its display's rate") are the inactive test's phase 4, the
thermal test's phase 2 and the hidden test's phase 2.

## Readings where the issue and design leave a choice

- **"A window you switch away from"** is read per window, as the criterion and the scope ("capped when you leave
  it") say: the window was key and you made another window of the app key, or another app. This replaces the #400
  suite's reading of `inactive` as "the app inactive" (its README, Readings), which it made before this criterion
  existed and with no run that made anything inactive. It doesn't contradict that suite's AC3: there no `activate` is
  ever reported, so no window is one you switched away from. That reading assumes an implementation doesn't infer a
  switch from a click or a pop-out; a click in a panel is an `input` (its serial), not a key-window report. The
  owner should confirm.
- **"The Mac is hot"** is read as the OS thermal state `serious` or `critical`; `nominal` isn't hot. `fair` is left
  to the implementer and never sent: the design says only "thermal: 60 Hz", and the technical design counts a budget
  only at `nominal`, which places `fair` on neither side.
- **"Presents at most N Hz"** is read on the virtual clock as no two consecutive frames of the window less than 1/N s
  apart, over the 200 ms read in each phase; and, so that a program presenting nothing doesn't pass, the window keeps
  presenting at its cap while something new reaches every latch (at most one frame short of N × 0.2 s). A frame
  latched before a signal may present after it, so each phase is read from 50 ms in; the hidden window is read from
  one frame of B after the hide.
- **"Evaluates none of its sessions"** is read through the `presented` reply's `evaluations`: no evaluation for the
  hidden window from a frame of B after the hide until it is shown. Since a visible window's frames each have an
  evaluation for their vsync, the list is checked against frames, not trusted on its own.
- **"Fails, naming the window and the cap"** is the planted program's failure sentence, which names the window ID
  and the cap as the design writes it (`inactive: 30 Hz`, `thermal: 60 Hz`, `hidden: 0`).
- **Hiding** is the window server's report, one call for minimizing a window or hiding the app's windows; a window
  that is merely covered by another isn't read.

Not tested, because no criterion asks: a window spanning two displays, `fair`, a hidden window's `deep_show`
reporting `not_presented(hidden)`, frame callbacks to a hidden session, caps combining (inactive while hot), and the
app's one GPU budget (#777).

## The Oracle lane

The issue names no upstream test; the caps are this design's own, so nothing upstream is ported and these tests are
the local proof for AC5.

# Acceptance tests for #777: one GPU budget for the app across windows on every display

Written first, from issue #777 (its scope, its Meter and degrade ladder fields and their "It can never" line, its two
acceptance criteria and its proof line), the design sections it links and those they lean on, and base commit
`7b39aa0d` ("Merge pull request #778 … feat/761-scrub-field-names"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Dogfooding (2518) and Tests written first (2549), with Wrong programs.
- `docs/canvas-primitives.md`: Meter and degrade ladder (905: `{scope: writer | session | layer | window | app, limits
  (from the class), estimate, measured: 120-frame ring, ladder: refuse → effects off → LOD down → internal_scale down
  → 30 Hz → freeze → placeholder, hysteresis: down after 30 frames, up after 120}`; "at run time it steps down only the
  costly writer's layer and tells that writer why at every rung"; "A layer steps down one rung after 30 consecutive
  presented frames whose charged GPU or CPU time exceeds its budget class's frame limit, its share; the count restarts
  after each rung change; one frame over moves nothing; rungs are taken in the listed order"; "It can never: Let one
  writer degrade another"); Frame clock and scheduler (723: per display, per window, "Each window is paced by its own
  display"); Frame callback and presentation feedback (756: `flags: … degraded(rung)`); Window and display placement
  (891: "one device and one cache serve every window under one app-wide GPU budget").
- The issue's own "It can never": give each window a budget of its own; step down a writer that isn't the costly one.
- At the base: AGENTS.md; `tests/acceptance/400/` (the model: README, helpers, its planted table, its displays and
  windows on `deep-show run`), `379/` (the meter and the ladder: `deep-gpu run`'s `live` call, the `test-meter`
  build's stub meter, `--backend noop`, its ladder test, rung and reason names, the class limits), `377/` and `380/`
  (READMEs and budgets, for conventions; neither drives the ladder); `crates/deep-gpu-layer/src/live.rs` (the `live`
  call's parser and reply), `crates/deep-gpu/src/meter.rs` (`Ladder`, `Reason`, `Ring`), `scripts/lanes.mjs`.

What the base already does and these tests don't credit: #379's `live` call runs the app's one live window of
sessions on a virtual clock, charges each writer per frame (by the stub meter in the `test-meter` build), keeps a
120-frame ring per writer, and steps a writer's layer after 30 consecutive frames over its class's limit, recording
each change and its reason. #400's `deep-show run` has displays and pop-out windows but no meter. There is no window
but the one in `live`, no meter scope but `writer`, no app budget summed across windows, and nothing that tells a
writer why its rung changed. At the base, `live` ignores the fields it doesn't know, so it runs these scenarios as one
window and answers without the fields below.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/777 --no-file-parallelism
npx tsc -p tests/acceptance/777/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first builds `cargo build --locked --bin deep-gpu --features test-meter` once, copies the binary out of
`target/debug` into a temporary folder, and fails each of its tests when the build fails. Each test writes its
documents into its own temporary folder and deletes it. The tests use node built-ins and vitest only. A run with
`--root tests/acceptance/777` may leave Vitest's cache in `tests/acceptance/777/node_modules/.vite` or a `.vitest`
folder; delete it. `scripts/lanes.mjs` needs `tests/acceptance/777/` in its `alone` list beside `379/` and `400/`,
since the files build a cargo binary; this README is the instruction, and the implementer makes that edit.

Everything is deterministic and runs on every platform: wgpu's noop backend, the stub meter's planted GPU charges and
the virtual clock, with no real GPU timing and no wall time. `fixtures/look.json` is #379's look, copied unchanged.
`BASE-FAILURE.txt` is the run at the base (home paths redacted to `~`); see the end of this file.

Nothing missing passes (invariant 2): a reply without a field the tests read (a view's `window`, `told`, the meter's
`app` row and its `windows`, `limits.gpu_ms` and `measured`, each `told` entry's fields) fails the test naming the
field; a run that exits non-zero, answers `ok: false` or refuses the call fails every test that drove it. No test
skips, and none needs a real display or GPU, so none is INCONCLUSIVE.

## The surface under test

The issue names the meter's `app` scope, windows on displays, the ladder and the writer being told why, but no code
API. The meter, the ladder and the stub meter live in #379's `deep-gpu run` `live` call, which stands in for the app's
live window; so these tests extend that call with the smallest set of fields they need, in its own style. No new
binary, call or build. #379's JSON-lines convention, its `live` fields (`look`, `frames`, `fps`, `sessions`,
`report`, `stub_meter`) and its reply fields hold unchanged except as below.

### Fields added to the `live` call

- **`windows: [{"window": ID, "display": uuid}]`**: the app's open windows, the first the main one, each on the
  display with that UUID (#400's display UUIDs; the tests use two distinct displays). Every window presents frame k at
  t = (k − 1) ÷ `fps`, as #379's one window does (the readings below). Without `windows`, the call has its one window
  as before. A `windows` that isn't a list of `{window, display}` with distinct IDs answers `bad_input`.
- **`Open.window`** (a session in `sessions` or an `open` event): the window whose view the session draws in. It must
  name a window of `windows` (else `bad_input`); without it, the main window.
- **`--planted`** takes the three names below.

The tests call: `--backend noop`, `fps: 60`, `report: ["meter"]`, three work-product documents (#379's moving scene
document), and `stub_meter.writers` (#379's) charging each writer its GPU ms per frame.

### Fields added to the `live` reply

- **`frames[].views[].window`**: the window the view drew in that frame.
- **`told: [Told]`**, in order: every message the core sent a writer about its rung (the design's "tells that writer
  why at every rung").

  ```json
  Told: {"frame": k, "session", "writer", "rung", "reason", "scope": "app" | "writer" | … | null}
  ```

  `rung` the rung it now holds; `reason` one of #379's reasons (`initial`, `headroom`, `frame_health`, `battery`,
  `you`); `scope` the meter scope whose budget the reading broke, `null` when no budget moved it (the initial rung,
  you, the battery). A writer is told at the frame of each change (#379's `changes[].frame`).
- **`meter`** (`report: ["meter"]`): #379's writer rows unchanged, plus exactly one row of scope `app`:

  ```json
  {"scope": "app", "windows": [ID], "limits": {"gpu_ms": n, …}, "measured": [ms]}
  ```

  `windows` every window the app has open, on any display; `limits` from the class (`gpu_ms` is the documents'
  class's frame GPU limit, work product 2 ms); `measured` the app's 120-frame ring after the last frame, oldest first:
  each entry one frame's GPU time summed over every window's frame, the charges of every view drawn. Any other rows
  are the implementer's, but a row of scope `window` never carries `limits` (null or absent): no window has a budget
  of its own.

Each window's GPU time in a frame is read as the sum of `charged_gpu_ms` over the views that name that window.

### Planted programs

Each reachable only through `deep-gpu run --planted <name>`, only to prove a test fails on a wrong program; every test
runs its own and asserts that it fails. A planted program changes only what its row says: its reply keeps every
field above.

| Name | The wrong program | Test |
|---|---|---|
| `budgets_each_window` | the meter budgets each window alone: each window's frames against the class's limit, never their sum | AC1 |
| `steps_main_window` | an app-budget step-down lands on the costliest writer of the main window, whichever window the costly writer draws in | AC2 |
| `tells_first_step_only` | a writer is told why at its initial rung and its first step-down, and not at later rungs | AC2 |

## Criteria to tests

Each test's name starts with its ID. The layout in both: display A with the main window `w-main`, display B with a
popped-out window `w-pop`; bravo (0.5 ms a frame) and charlie (0.4 ms) draw in `w-main`, alpha, the costly writer,
in `w-pop`; all three documents are work products (2 ms GPU), and every frame draws all three (a channel moves each
document; the view stays still).

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | With windows on two displays, the GPU time of their frames counts against one app budget: two windows each under the limit but together over it step the ladder down, and a meter that budgets each window alone fails, naming both windows | `app-budget.test.ts`, 120 frames: alpha 1.4 ms for frames 1–45, then 0.6 ms. Each window's frames as charged equal the stub's and stay under 2 ms (0.9 and 1.4 ms); together 2.3 ms. Alpha's layer steps base → effects off at frame 30 for frame health; bravo and charlie keep their initial rung only. The meter's app row covers `w-main` and `w-pop`, its limit is 2 ms, its 120-frame ring equals each frame's two windows summed (frames 1–45 over 2 ms, the rest under); no window row carries limits. A second run with alpha at 1.0 ms (1.9 ms together): only the initial rungs. Fails on: `budgets_each_window`, its failure sentence naming `w-main` and `w-pop` and their displays; also a ring of one window, a limit not the class's, a step at the wrong frame |
| AC2 | The step-down lands only on the costly writer's layer, in the window it draws in, and that writer is told why at every rung; the other window's writers keep their rung | `step-down.test.ts`, 150 frames: alpha 1.4 ms for frames 1–75, then 0.6 ms. Alpha steps base → effects off at 30 and → LOD down at 60 (frame health), nothing more; every frame each session draws in its own window; alpha draws at each rung from the frame it takes effect, in `w-pop`; bravo and charlie draw at base every frame, in `w-main`, with only their initial change. For every change, its writer is told that frame the rung and the reason; alpha's step-downs are told with `scope: "app"`, at 30 and 60. AC1's app check holds too. Fails on: `steps_main_window` (a main-window writer moved off base, named with the frame and rung), `tells_first_step_only` (frame 60 and LOD down named); also steps every writer, steps in the wrong window, tells the wrong writer or the wrong reason |

The proof line ("a two-display layout with one costly writer, the app budget's measured ring, and each writer's
rung") is these runs: the layout, the app row's `measured`, and each view's rung every frame.

## Readings where the issue and design leave a choice

- **One binary for the meter across windows.** The meter, the ladder and the stub meter are #379's, in `deep-gpu
  run`'s `live` call; #400's windows and displays are `deep-show run`'s, which has no meter. The smaller extension is
  windows in `live`: each named by ID and placed on a display by UUID. Placement rules (pop-outs need a serial,
  restore by UUID, the card) stay #400's and aren't read here.
- **"The GPU time of their frames counts against one app budget"**: frame k of the app is every window's frame k; its
  GPU time is the sum of every window's charged GPU time for that frame; the app budget's limit is the documents'
  class's frame GPU limit (all three are work products, 2 ms), "the class's limit" in the issue. With mixed classes
  the limit would be the implementer's reading; no test mixes them.
- **Two displays at one rate, in phase.** The `live` call's frames are at `fps` for every window. How frames of
  windows at different refresh rates sum into one app frame is left open by the issue and the design; #400 owns
  per-window pacing, and no test here mixes rates, so the windows carry only their display's UUID.
- **The costly writer** is the writer whose charge is the largest share of the over-budget app frames (alpha, 1.4 of
  2.3 ms, more than either window's other writers). The step-down follows #379: one rung after 30 consecutive frames
  over, decided at the end of frame 30, recorded with reason `frame_health`; the count restarts after each change.
  With the view still there is no climb (#379's reading), so "keep their rung" and alpha's held rung are read for the
  whole run.
- **"Told why at every rung"**: a `told` message for every change of every writer (including the initial rung), in
  the frame of the change, naming the rung and the reason, and for a frame-health step the budget that broke (`app`).
  The design's frame callback `degraded(rung)` flag says the rung but not why, so `told` is the new reading.
- **"A meter that budgets each window alone fails, naming both windows"** is the planted program's failure sentence,
  built from the reply's views: the windows, their displays and their charges.
- **Never a budget per window** is read as no `window`-scope meter row carrying limits; window rows themselves are
  optional.

Not tested, because no criterion asks: the climb above base and up after 120 frames; CPU time against the app budget;
windows at different refresh rates or a window spanning two displays; the app memory cap and its eviction; the
session and layer scopes; the battery and your own rung changes under the app budget.

## The Oracle lane

The issue names no upstream test; an app-wide GPU budget across windows and its degrade ladder are this design's own,
so nothing upstream is ported and these tests are the local proof for both criteria.

## At the base

`BASE-FAILURE.txt`: both tests fail (2 of 2, both files). The test-meter build succeeds, the base `live` call accepts
each scenario (it ignores `windows` and `window`) and draws it as one window, and each test then fails at its first
read of the new surface: `the live call: frame 1: views[0].window is a string, got undefined`. That is the missing
surface, not a test mistake: every check here reads each view's window, `told` and the meter's `app` row, which the
base doesn't have, and the planted names, which the base refuses at startup. Before the base run, the checks
(`appBudgetProblems`, `ladderProblems`, `rungProblems`, `toldProblems`) were run once by hand on synthetic replies (a
correct app budget, and each planted program's behavior): they passed the correct one and failed each planted one with
the sentences the tests match. That scratch file isn't kept.

# Acceptance tests for #169: share a live piece, a playable page of its rendered states

Written first, blind, from issue #169 (live, November 13, 2026: its Scope, its Fields, its eight acceptance criteria
and its Proof line), its oracle page and the base commit `23baa43b4` ("Merge pull request #2453"), by a job that never
saw an implementation; none existed. No other worktree, branch, PR, stash or plan was read, and every repo file was
read through the base commit. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

**Not run.** The surface plainly doesn't exist at the base (`video.codec: page` answers `unknown_target`), and the
machine is shared and loaded, so no Rust was built and no test was run. `BASE-FAILURE.txt` says, per test, the
assertion it meets first at the base, read from the base's code. The type check passes (`tsc -p
tests/acceptance/169/tsconfig.json`, exit 0) and `vitest list` collects the 17 tests below.

## What was read

- The issue, live (`gh issue view 169 --repo windoliver/deepbuild`), and its oracle page
  (`doneright/oracles/issues/169.md`, branch `doneright` of DeepBuildAI/deepbuild): 0 of 8 criteria have an upstream
  test, so there is no oracle folder.
- `docs/technical-design.md`: Films and figures on the canvas (its Export and Interactive figures bullets), Privacy,
  How we know version 0 works (Dogfooding, tests written first).
- `docs/canvas-primitives.md`: Export (fields, receipt, Semantics, "It can never"), Export: playable page, Export: web
  player, Marker and Marker: present mode, Control, Variant, Carried state, Render-back, Logic: checkpoints and bake,
  Check input: export kinds, Transport, Input track, Tour, `start_on` and `switch`, Bound value, Status binding.
- `docs/parallel-proof.md` (the timed list, budget windows, task `criteria`), `AGENTS.md`, `CONTRIBUTING.md`.
- At the base, for surfaces only: `crates/deep-show` (`main.rs`: the call list, `eval`'s fields with `track`, the
  scenario's `record` and `planted`; `export.rs`: `Job::parse`, `Job::target`, `unknown_target`; `access.rs`: `see`'s
  tree with target nodes `<control>/<option>`; `input.rs`: control events, `appended`; `capture.rs`: `send` and
  `approve`, the planted `sends_without_approval`; `present.rs`; `Cargo.toml`'s features);
  `crates/deep-canvas-export/src/lottie/mod.rs` (`status_refusal`); `crates/deep-canvas/src/registry/mod.rs`
  (`Registrar::carried`, `Stepper`); `crates/deep-canvas-test-modules/src/time.rs` (how `test.tick` registers);
  `crates/deep-canvas-motion` (`controls_of`, `tests/figures_504.rs`);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/benchmark.mjs` (`validateBudgets`, `judgeLimit`,
  `fingerprint`), `scripts/lanes.mjs`, `benchmarks/budgets.json`; the suites `501/`, `162/`, `507/`, `504/`, `376/`,
  `488/`, `1919/`, `238/`, `157/`, `105/`, `1723/` as patterns.

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, then run one file at a time (each builds the `deep-show`
feature set it lists once, in `beforeAll`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
node node_modules/vitest/vitest.mjs run --root tests/acceptance/169 walkthrough.test.ts --testTimeout=600000   # AC1, AC7 (a browser)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/169 refusals.test.ts --testTimeout=600000      # AC2
node node_modules/vitest/vitest.mjs run --root tests/acceptance/169 quiz.test.ts --testTimeout=600000          # AC3
node node_modules/vitest/vitest.mjs run --root tests/acceptance/169 bound.test.ts --testTimeout=600000         # AC4 (a browser)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/169 budgets.test.ts --testTimeout=600000       # AC5 (timed leg: a reference Mac)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/169 carried.test.ts --testTimeout=600000       # AC6 (its own build)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/169 taste.test.ts --testTimeout=600000         # AC8
node node_modules/typescript/bin/tsc -p tests/acceptance/169/tsconfig.json                                  # type check
rm -rf tests/acceptance/169/node_modules                                                                    # vitest's cache after a --root run
```

Every `it` passes its own 3,600,000 ms timeout, which wins over `--testTimeout`. Every file but `carried.test.ts`
builds only `full`, so after the first the others reuse cargo's build. Temp folders are removed after each test or
file; Chrome runs in a process group of its own and is stopped by that PID; nothing is stopped by name or port.

`scripts/lanes.mjs` needs these lines (this job writes only its folder; the implementer adds them). Every file builds
`deep-show` and exports through the GPU, two drive a browser, and `budgets.test.ts` times exports and reads the load:

```js
alone.push('tests/acceptance/169/');
timed.push('tests/acceptance/169/budgets.test.ts');
```

`walkthrough.test.ts` takes about 530 actions in a browser, most of them playing an edge, and will likely belong on
the `slow` list once its fastest run is recorded.

## Criteria to tests

IDs are `#169.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`; checked against the live issue). Each test's name starts `AC<n> #169.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#169.b1f34a83` | `walkthrough.test.ts` (2) | 24 states in the receipt and the manifest, one per stage × explode × finish, the start the defaults; each state's still, decoded, hashes (BLAKE3 of BGRA8) to the app's own png_seq still export of that state (fails on: two states' stills swapped, naming the state). In Chrome with networking off: a circuit takes every action in every state once, 7 target clicks and 8 keys, each landing where its controls say, an edge played when they change and none when not; 7 targets shown in every state; all 24 states reached; no request outside the page's own files (fails on: a copy of the page that asks the network for one picture, naming the URL, the request reaching nothing) |
| 2 | `#169.2418fae7` | `refusals.test.ts` (3) | the dial sampled 65 times refused naming `dial`; the plate with status binding `lamp_status` refused naming it, the unbound plate exported; the 5 × 13 grid refused naming `ctl_rows` and `ctl_cols`; nothing written for any refusal (fails on: the merge base, whose `unknown_target` names none; a program that refuses every page, at the unbound plate) |
| 3 | `#169.3b8550af` | `quiz.test.ts` (1) | 27 states held at the marker `end`, one per answer combination; each one's still hashes to the app's still at `end` on that path's input track, on the same machine (fails on: the all-right and all-wrong stills swapped, naming the path) |
| 4 | `#169.acd10c7d` | `bound.test.ts` (2) | in Chrome with networking off, the bound value shows as text holding 42 with a `<time>` at its as-of time (fails on: the as-of time taken out, naming it); the photo's page says `redaction: incomplete`, lists its files, each in the evidence store; #105's send of them waits and delivers nothing until `approve`, then each goes once (fails on: #105's planted `sends_without_approval`, naming a hash) |
| 5 | `#169.e6c2fc38` | `budgets.test.ts` (3) | a `benchmarks/budgets.json` task naming the criterion, valid against the merge base; the player under 100,000 bytes on any machine; on a reference Mac, five runs after a warm-up at 1080p30: 24 states, 100 to 150 edges, `timing.wall` under 240 s and under 250,000,000 bytes written, by `judgeLimit` |
| 6 | `#169.a87c5184` | `carried.test.ts` (3) | the build seals `test.latch` and neither logic nor physics; the fixture's two paths end on one picture, their reveals on two, and the app's carried-state lists differ in `test.latch` alone; the page keeps the two ends as two states with the same controls whose reveal successors differ, and the four stills hash to the app's at the ends of their paths (fails on: the planted `page_keys_by_picture`, naming `test.latch`) |
| 7 | `#169.fa0fa9b6` | `walkthrough.test.ts` (2) | in Chrome with networking off, in every state Tab reaches all 7 targets and Enter on each plays its edge to the state it picks (a circuit per explode half); each state's tree in the browser equals the app's `see` tree for that state, node for node, in order; the planted `page_targets_on_image` fails, naming the first target (`tour/plate`, the first button of the app's start tree) |
| 8 | `#169.5ca52f96` | `taste.test.ts` (1) | reads the record only (The taste call) |

## The surface under test

`deep-show run` (#393's scenario: one JSON line in, one answer line `{"ok": true, "replies": [...]}` out), with the
scenario's `planted` key for the wrong programs (as #162's, #504's and #507's suites), its Cargo features for build
sets, the files the export writes, and a browser. No new binary, subcommand or call; one new field on `eval`.
**Every name marked *(chosen)* is this job's**, taken from the design's words and shaped like the neighbouring calls;
the implementer builds exactly these, or a dispute goes to a blind redraft. Times are flicks or time literals; rates
`[p, q]`; hashes lower-case hex.

### `export` with `video.codec: page`

`{call: "export", doc, out, video: {codec: "page", page?: {sample?: {control, count}, orbit?: {frames}, still?}},
size?, frame_rate?}`. The issue's `page` options sit inside `video` *(chosen: the export's `page` field already names
a print page)*. `out` is the page's folder, written whole or not at all, like every export.

Outcomes: `"exported"` with `receipt`; `"refused"` with `code` (the code's name is the implementer's) and nothing
written in `out`'s folder, the refusal's JSON naming the control, the binding or the controls that multiply.

**The receipt**, as read here: the issue's `states`, `edges` (whole numbers), `bytes` (a whole number) and `warnings`
(an array); Export's `timing.wall` (seconds); and *(chosen)* `redaction: "complete" | "incomplete" | "unknown"`, the
page's redaction, `incomplete` when any asset it shows says so in its document entry (`assets.<id>.redaction`), and
`files: [{path, sha256}]`, every file the page wrote, by its path under `out` (`/`-separated) and its SHA-256, each
also put in the scenario's evidence store (origin DeepBuild), since files leave the machine only by hash from there.

### The page's folder *(chosen)*

- `index.html`, opened from disk (a `file://` URL, no server): the page plays from its folder alone.
- `manifest.json`: `{start, states: [{id, controls, marker, still}], edges: [{from, to, control, value}]}`. A state's
  `controls` holds the value of each control its key holds, as an input entry writes it (a stage's ID, a toggle's
  boolean, an option's name); `marker` is the stage or waiting marker the timeline holds at in that state, or null
  for a piece without one; `still` is its still's path under the folder (a PNG with the default `still: png`). An edge
  sets `control` to `value` from `from` and lands in `to`. The design's keys, target boxes and anything else may sit
  beside these; no test reads them.
- `player/`: every file of the fixed player, and nothing else. The player's size is these files' bytes plus any
  script or style written inline in `index.html`.

### The page's DOM *(chosen)*: how the page shows the browser where it is

- `<html data-deep-state="<state id>">` names the state the page shows, from its first paint. While an edge plays,
  `<html>` also carries `data-deep-edge` (any value), added when the edge starts and removed when it lands, after
  which `data-deep-state` names the state it landed in. A click, key or Enter that picks the current value plays no
  edge.
- Each target the state has (Control's `targets`): one element `[data-deep-target="<control>/<option>"]` (a stage's ID
  for a stages control), in the Tab order; a click on it, or Enter while it has focus, plays its edge.
- A key in a control's `keys` pressed anywhere on the page plays its edge.
- The page's accessibility tree: an element `[data-deep-id="<node id>"]` for each node of the app's tree (#376's
  `see`: the document's ID, item IDs, control IDs, and `<control>/<option>` for targets), in the app's order, not
  ignored by the browser's accessibility tree. Its name is the browser's computed accessible name; its role is its
  `aria-roledescription`, else its `role` attribute, else the browser's computed role (so `<button>` reads `button`,
  and a part may be `role="img" aria-roledescription="part"`).
- A bound value: an element `[data-deep-bound="<bound value ID>"]` that shows the value's text and holds a
  `<time datetime="<ISO 8601>">` of its as-of time with text of its own.

### Other calls

| Call | Request | Reply read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document`, `include: ["issues"]`, `at?` | `outcome: "presented"` | existing |
| `export` (png_seq still) | `doc`, `out`, `video: {codec: "png_seq"}`, `size`, `frame_rate`, `track`, `range: {still: {t}}` or `{still: {marker}}` | `receipt.frame_hashes[0]` (BLAKE3 of the raw frame) | existing (#501, #544, #507's waiting path) |
| `eval` | `doc`, `t`, `track`, **`carried: true`** | **`carried: [{owner, kind, key, hash}]`** *(chosen)*: one row per entry of the core's carried-state list at `t` on that track, `owner` the canvas module that declared it, `kind` its kind, `key` its declared key, `hash` its state's hash (equal states, equal hashes) | existing call; the field new |
| `input` | `at`, `panel`, `event: {type: "control", control, value}` | — | existing (#504) |
| `see` | `at`, `panel` | `tree: [{id, role, name}]` | existing (#376, #504) |
| `send` | `session`, `to`, `files: [sha256]` | `send: {id, state: "waiting" \| "sent"}` | existing (#105); a page's files new |
| `approve` | `send` | `send: {id, state}` | existing (#105) |
| `registry` | — | `modules` | existing |

The scenario: `{evidence, sessions, processes, panels, docs, record, clock?, planted?, calls}`, as #162's world: an
agent session whose process tree shows the bound documents, and whose `record` holds the verdict
(`verdict:01JB169V…01`, state fail) a status binding reads and the reading (`reading:01JB169R…01`, value 42, as of
1,794,475,800,000 ms, 2026-11-12T09:30:00Z) a bound value reads.

### Cargo features of `deep-show` *(chosen)*

| Feature set | What the build holds | Files |
|---|---|---|
| `full` | the shipped full set (existing) | all but `carried.test.ts` |
| `full,test-leave-out-logic,test-leave-out-physics,test-page-latch` | the full set without the logic and physics modules (both features exist), with **`test-page-latch`**: the test canvas module below | `carried.test.ts` |

### The test canvas module `test.latch` *(chosen)*

In no shipped build; registered as `test.tick` is (`crates/deep-canvas-test-modules`). Version 1.0.0. Kind
`test.latch@1 {box, watch: control ID}`, drawn as `rect@1`. It declares carried state in the core's carried-state list,
`r.carried("checkpoint", "test.latch.state", 64)`, checkpointed. A stepping operator (simulate, 60 Hz) holds `seen`, 0
at the start, set to 1 at the first step at which the control `watch` names, read through the core (Control: "the core
resolves that value from the input track"), holds a value other than its default, and never set back. An items
operator moves its item by `[120 × seen, 0]` u through a transform contribution, as `test.tick` moves its own. It reads
no logic or physics array, so it builds without both.

## Planted programs (the scenario's `planted`)

Each is reachable only through the scenario's `planted`; at the base each new name answers `bad_input`.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `page_keys_by_picture` *(chosen)* | the page export keys each state by its picture (the raw frame hash of its still) and its controls' values alone, never by the core's carried-state list, so two states alike in both become one | 6 | `test.latch` |
| `page_targets_on_image` *(chosen)* | the page export draws each state's targets only as boxes on its still, a click inside a box playing that edge, with no element for a target in the DOM, the Tab order or the accessibility tree | 7 | the first target, `tour/plate` |
| `sends_without_approval` | #105's: a send delivers its files without waiting | 4 | a file's hash |

The other wrong programs are made in test code: two states' stills swapped (AC1, AC3), a copy of the page with a
picture from the network added to the top of its index page (AC1), and the as-of time taken out of the loaded page
(AC4). AC2's are the merge base and a program that refuses every page (the unbound plate).

## Fixtures

All made at test time in `helpers.ts`; no personal data; CC0. 2D documents carry an ink band over their lower third,
so no frame is flat under export's film.blank guard; no text shows a digit or a number word; every size is even.

- **The walkthrough** (`walkthrough`; AC1, AC5, AC7, AC8): a 3D figure in metres, written as #504's box figure and room
  are. A floor; four parts in four assemblies (plate, shell, cover, cap); three swatches. A stages control `tour`
  (`tablist`, label Tour, default `plate`) of four stages `plate`, `shell`, `cover`, `cap`, each a stage shot of the
  orthographic camera from azimuth 25° and elevation 20° with its own target and view width (a glide of 0.8 s), each
  targeting its part, keys p, s, c, a. A toggle `explode` (`switch`, default false, key e) whose follow takes the
  assemblies apart, staggered (about 1 s). A choice `finish` (`radiogroup`, default `lagoon`) on the variant set
  `finish` (lagoon, orchid, graphite: the shell's fill accent, session_readout or ink), targeting the three swatches,
  keys l, o, g. 24 states; exported at 640 × 360 and 30 fps. With `loop` (AC5) a fan turns once every 3 s and the
  transport wraps at 3 s, so each state is a 3 s loop. The app's still of a state: its three controls' entries at
  0.5 s, the still at 2 s, settled.
- **The quiz** (`quiz`; AC3): a 2D film, 320 × 180 at 10 fps, 4.1 s. Stage markers `ask1`, `ask2`, `ask3` at 1, 2 and 3 s
  waiting for choices `q1`, `q2`, `q3` (options a, b, c, no default; right answers b, c, a), each question's text shown
  while the timeline is at it, and the stage marker `end` at 4 s, the last frame, where #507's counter of right answers
  shows. The app's still of a path: answers on the clock at 1.5, 3.0 and 4.5 s, the still at marker `end`.
- **The latch figure** (`latchDoc`; AC6): 2D, 320 × 180 at 30 fps. Choices `knob` and `reveal` (off, on; default off),
  each moving an item into view by a driver (the lamp; the latch, `test.latch@1` watching `knob`). Paths: the start;
  knob on at 0.5 s and off at 1.0 s; each then reveal on at 1.5 s; the app's stills at 2 s.
- **AC2's pieces**: the dial (slider `dial`, 0 to 100, moving a dot); the grid (choices `ctl_rows` of 5 options and
  `ctl_cols` of 13, moving a block: 65 states); the plate with status binding `lamp_status` on its fill, and the same
  plate unbound.
- **AC4's pieces**: the bound reading (a `data` text `price` whose text the bound value `price_now` fills); the photo
  (an `image@1` of a 96 × 64 solid PNG whose asset entry says `redaction: incomplete`).

## The browser

Google Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`), headless (`--headless=new`), driven over its
DevTools protocol by `helpers.ts` alone, with no library, as #238's suite drives it (the page's clips may need Chrome's
own codecs). The driver clicks at a target's centre with the protocol's mouse events (failing when another element
covers it), presses keys with its key events, reads the accessibility tree with `Accessibility.getFullAXTree`, and
runs no code in a page but its reads, its edge counter and, for AC4's wrong program, taking out the as-of time. "Networking off" is three things at once:
each page offline (`Network.emulateNetworkConditions`), every host name resolving nowhere
(`--host-resolver-rules=MAP * ~NOTFOUND`), and every request sent to a closed proxy port, loopback included. Before a
page is opened, a canary `fetch` of this test's own local listener must fail, reach nothing, and appear in the request
log, or the test is BLOCKED. Every request a page starts is recorded from the protocol (`Network.requestWillBeSent`,
`Network.webSocketCreated`), blocked or not; one that isn't a `file://` URL inside the page's folder, or `data:`,
`blob:` or `about:`, fails the test, naming it. The driver itself was tried once on a hand-written page in a scratch
folder (canary, clicks, keys, Tab and Enter, the tree, a bound value, the leaky copy); no page of this issue exists yet.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every browser test is BLOCKED without Google Chrome at the path above, when Chrome opens no DevTools port within
  60 s, or when the canary shows networking isn't off or the log missed it.
- AC5's timed leg is INCONCLUSIVE off a reference Mac (Mac15,7, Mac15,12, Mac17,10, by `scripts/benchmark.mjs`
  `fingerprint`) or not on mains power, with Low Power Mode on or the thermal state not nominal, and whenever
  `judgeLimit` reads the five runs as neither all within nor all over, or a run's load was above the cores.
- AC8 is INCONCLUSIVE without the pictures in `docs/evidence/169/` or without a recorded call on exactly them.

## The taste call

The check run takes, from the walkthrough's page in a browser, `page-start.png` (the page at its start),
`page-exploded.png` (after the explode toggle), `page-lagoon.png`, `page-orchid.png` and `page-graphite.png` (the three
finishes), and `page-stepping.webm` (a recording of stepping through the stages and the toggle), puts them in
`docs/evidence/169/` *(names chosen)*, attaches them to the PR and shows them in the session. The call is recorded in
`tests/acceptance/169/TASTE.json`: `{issue: 169, criterion: "#169.5ca52f96", verdict: "looks_right" | "looks_wrong",
who, when (ISO 8601), screenshots: {<name>: sha256}, note?}`. This job writes no TASTE.json and makes no picture.

## Readings where the issue and design leave a choice

- **"The raw frame hash the app's export of that state recorded"** (AC1) is the app's own export of that state, a
  png_seq still on an input track that sets its controls, and its receipt's frame hash; not the page export's own
  record, which a page that drew every state alike would match.
- **"Clicks every target and presses every key"** (AC1) is every target and every key in every state; each action is
  taken once per state, in a circuit that needs no travel. Its outcome is the state whose controls the action sets.
- **"Makes no network request"** is no request started to anything but the page's own files, blocked or failed or not.
- **The walkthrough's stages** are a stages control (Control: Stages), so targets pick them; its 24 states are its
  controls' 4 × 2 × 3 values, each read by the frame.
- **"About 120 edges of 1 s"** (AC5) is 100 to 150 edges in the budget runs; AC1 and AC7 don't count edges, since the
  design leaves open whether a stage edge joins any two stages or neighbours only.
- **"3 s states"** (AC5): the walkthrough's transport wraps every 3 s while a fan turns, so each state loops for 3 s.
- **"Naming"** (AC2) is the refusal's JSON holding the ID. The 65-state grid passes both caps; either refusal names
  both controls.
- **"End state"** (AC3) is a state held at the marker `end`; **"its score shows what the app shows ... by pixel hash"**
  compares the whole end still with the app's still at the end of that path.
- **"Leaves the machine"** (AC4) is #105's send by hash from the evidence store, and **"your approval"** #105's
  `approve`. A page's redaction is incomplete when an asset it shows says so (the design: license and redaction live on
  the asset).
- **"Each still"** (AC6) is the two ends' stills and their two successors': the ends alone look alike, so their
  successors are what show the page kept them apart. **"Naming the module"**: the failure names the module whose rows
  the app's carried-state list holds differently at the two ends.
- **"Equals the app's ... as data"** (AC7) is `{id, role, name}` for every node, in order. **"The first target"** is the
  first button of the app's tree in the start state.
- **"Reachable by Tab"** (AC7): from wherever focus is, at most 80 presses of Tab give the target focus.

## Not tested, and why

No criterion asks: the turntable (`orbit`), a sampled slider within its cap, `still: jpeg`, the clips' sound and
captions, the `share` fields and `share.png`, the warnings for a second continuous control or a drag past its samples,
the target boxes in the manifest against render-back's ID table, a readout announced when an edge lands, refusing a
piece past 256 edges alone or one naming a logic item, the content policy's own text, licenses, the web player and its
fallback, and a page counting as evidence.

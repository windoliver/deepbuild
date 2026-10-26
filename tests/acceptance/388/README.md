# Acceptance tests for #388: R1's canvas as canvas modules, and the core and r1 build sets

Written first, from issue #388 (its scope, its two acceptance criteria, its proof line "The published schedule
and its snapshot, and the core and r1 build sets built in the local preflight", and its Oracle line), the design
sections it names and those they lean on, and base commit `d18a3c62f49e49316a7944a6cf7c5ce4d5181fcb` ("Merge
pull request #742 … feat/379-meter"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read:

- `AGENTS.md`; `docs/technical-design.md`: The canvas core and its Canvas modules paragraph (the core's parts;
  "Registration runs in sorted name order; then the registry seals"; "ties break by name and then by depth,
  order key and ID, and each canvas module's fixtures prove a cached result equals a clean rebuild"; "build sets
  core, r1, r2 and full, each a list of modules; text and look are in every one, since a status mark needs text's
  shaper and atlas and look's status map"; "the scheduler's task lays R1's canvas code out as canvas modules"),
  its module table (text, marks2d, data, graph, record, sheet, motion and look rows), Document (`requires`,
  `module_missing`), Rules every primitive follows, and Dogfooding.
- `docs/canvas-primitives.md`: the status-color rule (around line 70: "Every status mark carries its state's
  glyph, or its word, in the same item, and the legend shows the glyph, the color and the word"; "Status colors
  draw unlit … with an automatic legend"); Canvas module (fields, `registers: {…, fixtures}`); Registry and seal
  (1034: `modules` sorted by name, `build_set`, "The sealed plan is published as `deep://schedule/<core
  version>` and compared with a committed snapshot", the four build sets' lists, "A build that leaves text or
  look out is refused at startup, naming the module"); Status binding (2177: the nine states, `legend: auto`,
  "A legend entry, with the state's glyph, color and word, appears whenever a status color is on screen"; "The
  bound mark draws the state's glyph or word itself"); Bound value; Look `look@1` (2407: `status`,
  `status_treatment.glyph`, "It can never: … draw a status color without its glyph or word").
- At the base, to learn the surfaces: `crates/deep-show` (`deep-show run` and its scenario, the `registry`,
  `schedule`, `fixtures` and `eval` calls, the scenario's `shuffle` and `record`, the startup `--planted`
  argument and its `bad_input`, the `seal_refused` line, the build-set Cargo features `core`, `r1`, `r2` and
  `full`, the committed `schedule/*.json`); `crates/deep-canvas/src/registry/` (`BuildSet`, `KNOWN_MODULES`,
  `SealError`); `crates/deep-canvas-marks` (`modules.rs`: text, look and marks2d as modules; `scene.rs`'s
  `StatusMark`; `looks/clean.json`); the earlier blind suites `tests/acceptance/305/` (builds per feature set,
  test features, startup `--planted`, the refusal line), `387/` (`shuffle`, `eval`, `fixtures`, legal orders,
  `fixtures/parity/kernel/*.scene`), `392/` (the text snapshot of status marks and the legend), `393/` (PNGs in
  the evidence store) and `138/`; `scripts/lanes.mjs`.

## Run them

They build `deep-show` per Cargo feature set, like #305's and #387's, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs `'tests/acceptance/388/'` added to its `alone` list, which both leaves the folder out
of the parallel vitest line (`--exclude tests/acceptance/388/**`) and runs it on the one-at-a-time line beside
`tests/acceptance/387/`; that is how "built in the local preflight" reaches these builds. This README is the
instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/388 --no-file-parallelism
npx tsc -p tests/acceptance/388/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

(The two cargo variables only keep the builds small and fast; the tests pass the environment through.) Every
file first builds each feature set it uses, once, with `cargo build --locked --bin deep-show
--no-default-features --features <set>[,<test feature>]` in the checkout, copies the binary out of
`target/debug` under its own name in a temporary folder, and fails each test that uses a build that failed.
Each test opens an evidence store root in a temporary folder and deletes it. The tests use node built-ins and
vitest only, and run headless on the CPU (render-back through Vello CPU): no GPU, no app, every platform. A run
with `--root tests/acceptance/388` leaves Vitest's cache in `tests/acceptance/388/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base: all 11 tests fail there, each for its own reason (see its header).

## The surface under test

Everything is `deep-show run` as #393, #305 and #387 left it: JSON lines in, one reply per call, the scenario's
`record` and `shuffle`, the `registry`, `schedule`, `fixtures` and `eval` calls and their replies, the
`seal_refused` startup line and exit 2, and the startup `--planted <name>` argument (an unknown name answers
`bad_input` and exits 2). This issue's tests read those unchanged and add what follows. Names the implementer
must add are in **bold**.

### The build sets (the `core` and `r1` Cargo features)

- `--features core` seals with `registry.modules` exactly `["look", "text"]` and `build_set: "core"`.
- `--features r1` seals with `registry.modules` exactly `["data", "graph", "look", "marks2d", "motion",
  "record", "sheet", "text"]` and `build_set: "r1"`.

(`modules` is sorted by name and names canvas modules only; the core's own operators stay `module: "core"`.)
The tests don't build `r2` or `full`; their snapshots must still equal their plans (the base's
`cargo test` already holds all four).

### Test builds that leave a module out

Two **test features** of `deep-show`, each in no shipped build, take one module out of the build set's list
before registration:

| Feature | Combined with | Startup |
|---|---|---|
| **`test-leave-out-look`** | `core` | refused: one line `{"ok": false, "code": "seal_refused", "reason": "missing_core_module", "modules": ["look"], "arrays": []}` and exit 2, no scenario read |
| **`test-leave-out-text`** | `core` | refused: the same with `"modules": ["text"]` |

The reason **`missing_core_module`** is a new word in the seal's closed list (#305's line shape). `modules` must
name exactly the module left out: on the core set nothing else depends on text or look, so a refusal for some
other reason (a missing dependency naming a second module) fails.

### The planted seal: **`--planted starts_without_look`**

`deep-show run --planted starts_without_look`, beside #305's `treats_every_dependency_required` and #387's
`orders_steps_by_name`, runs the seal that lets a build without look start, reachable only through that argument.
On `core,test-leave-out-look` it starts with `registry.modules` exactly `["text"]`, and a deep_show of the core
build's status fixture board is still **presented with its snapshot**, whose `marks` holds an entry for each
status binding drawn **with no `glyph`** (absent, `null` or `""`): there is no status map to give one. The suite's
status check must then fail, naming the mark (`mark <item> (<state>) draws no glyph`).

### Fixtures

`{"call": "fixtures"}` (#387) lists each fixture with its `module` and optional `record`. The tests read:

- in each of the `core` and `r1` builds, **every canvas module of the set registers at least one fixture**, and
  every fixture's `module` is `core` or a module of the set;
- the `core` build registers **at least one fixture board with a status mark**: `profile: "board"`, a non-empty
  `status_bindings`, registered by `core`, `text` or `look`, with a `record` that gives each bound source a
  `state` (one of the nine). The board's item kinds are the implementer's, as long as the core set draws them;
  the tests read only the bindings, the record and what is drawn.

### The status marks and the legend drawn: new fields on each snapshot

Each entry of a deep_show reply's `snapshots` (the render-back snapshot `{"sha256", "w", "h"}`, #393) **also
carries the text snapshot of the status marks and the legend it drew**, the shape #392 gave `deep-canvas-render
render`:

```json
{"sha256", "w", "h",
 "marks":  [{"item", "binding", "state", "color": [r, g, b], "bounds": [x, y, w, h], "glyph"?: string, "word"?: string, "label": [x, y, w, h]}],
 "legend": [{"state", "glyph", "word", "color": [r, g, b], "swatch": [x, y, w, h]}]}
```

One `marks` entry per status binding drawn: its item and binding IDs, its state, the sRGB color its fill draws,
its bounds, the glyph and the word it draws, and the box of that glyph and word; one `legend` entry per state on
screen. Boxes are in pixels of the PNG; the tests show each board at its own `size`, so one u is one pixel. Both
are `[]` on a snapshot with no status color. The PNG is read from the evidence store at
`<root>/<2 hex>/<62 hex>`.

## Fixtures of this suite

- `fixtures/parity/determinism/legal-order-shuffle.scene` (JSON, as #387's `.scene` files): the builds `core` and
  `r1`; every fixture each build's `fixtures` call lists, with its `record`; the times `0s`, `0.5s` and `1s`; the
  shuffle seeds 1 to 8; and what is compared (each node's key and result, the step log, the snapshot). The base
  has no `parity/` tree, so the scene lives here, to be moved when the corpus lands, as #96's and #387's did.

The status board is not a file here: the criterion names "a fixture board", and the core set's modules register
it (see Readings).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#305's command, with the issue's two criterion lines on stdin, read from the live
issue). Each test's name starts with its criterion's ID.

| ID | Criterion clause | Tests, and the wrong program each fails on |
|---|---|---|
| `#388.46473baa` | The sealed plan equals its committed snapshot | `schedule.test.ts` (3): for `core` and for `r1`, the build holds exactly its list; the `schedule` reply is published at `deep://schedule/<core>`, says its `build_set`, carries the registry's `set_digest` and runs only operators of the core and the set's modules; it equals `crates/deep-show/schedule/<set>.json` field by field and operator by operator; and the comparison names the operator in a snapshot with one operator dropped and in one whose operator reads more (the comparison isn't vacuous). A third test: r1's plan is not the core snapshot, r1 registers operators of the modules it adds and the core build has none of them, and the difference names one. Wrong programs: a plan drifted from its snapshot; a snapshot of another set; a set with an extra or missing module |
| `#388.46473baa` | evaluating each fixture under 8 legal orders shuffled by a seed gives identical hashes (parity/determinism/legal-order-shuffle.scene) | `shuffle.test.ts` (2), for `core` and for `r1`: the set holds exactly its list; every module of the set registers a fixture; each fixture is shown and evaluated at 0, 0.5 and 1 s with a snapshot, unshuffled and under `shuffle` 1 to 8 (a fresh process each); every node's key and result, the step log and the snapshot equal the unshuffled frame's; each order is legal (phases in the closed order, a writer's node before its reader's on one item); and the shuffles ran at least one order other than the unshuffled one. Wrong programs: a result that depends on tie order; a module laid out with no fixture; a set holding the wrong modules |
| `#388.c1a5581d` | The core and r1 build sets seal in the local preflight with exactly the canvas modules their lists name | `sets.test.ts` (2): `registry.modules` is exactly `["look", "text"]` for `core` and exactly the eight for `r1`, sealed, sorted, unique, `build_set` right; each failure names the extra or missing module. "In the local preflight" is the lane line above |
| `#388.c1a5581d` | in the core set a fixture board's status mark draws its state's glyph and word beside its color, with a legend | `status.test.ts`, first test: in `core`, each status fixture board shown with a snapshot: each binding is one mark in its source's state; its `color` and the most common pixel inside its bounds are the clean look's color for that state; its `glyph` is the clean look's glyph for the state and its `word` the state's word ("needs you" for `needs_you`, without case); its label lies inside the mark or outside within 16 px and has ink drawn in it (at least 4 pixels at 3:1 against what is behind); the legend shows each state on screen once, with that glyph, word and color, its swatch drawn in the color, and no state that isn't on screen. Then the same board with every state moved to the next of the nine: the same check passes and the marks' states changed. Wrong programs: color alone, a glyph or word missing, a fixed glyph whatever the state, no legend or a fixed one |
| `#388.c1a5581d` | a test build that leaves look out, and one that leaves text out, each refuse startup, naming the module | `sets.test.ts` (2): `core,test-leave-out-look` and `core,test-leave-out-text` each exit 2 with one `seal_refused` line, `reason: "missing_core_module"`, `modules` exactly `["look"]` or `["text"]`, and no reply to the scenario. Wrong program: a build that starts without look or text |
| `#388.c1a5581d` | and a planted seal that lets a build without look start draws the mark with no glyph and fails, naming the mark | `status.test.ts`, second test: `--planted starts_without_look` on `core,test-leave-out-look` starts with `modules` `["text"]`; the core build's status board is presented with a snapshot whose marks have no glyph, and the status check fails with `mark <item> (<state>) draws no glyph` for each bound item |

Test count: 5 for `#388.46473baa`, 6 for `#388.c1a5581d`, 11 in all.

## Readings where the issue and design leave a choice

- **"The sealed plan" is the `schedule` reply**, the plan the design says is published at `deep://schedule/<core
  version>`, and "its committed snapshot" is `crates/deep-show/schedule/<set>.json`, where #387 committed them.
  The proof line names the core and r1 sets, so those are the ones held; a snapshot that matches but belongs to a
  set with the wrong modules isn't this issue's plan, so each test checks the set first (softly, so the rest of
  the test still reports).
- **"Each fixture"** is every fixture the build's `fixtures` call lists: the design gives each canvas module
  fixtures that prove a cached result equals a clean rebuild, and laying R1's canvas out as canvas modules means
  each of the eight registers its own. **"Identical hashes"** are #387's: each node's key and result, the step log
  and the snapshot, at three times so motion's fixtures move. **"Legal orders"** is #387's legality check. The
  orders must not all be the unshuffled one, or nothing was shuffled.
- **"Exactly the canvas modules their lists name"** is `registry.modules` equal to the list; the core's own
  operators are `module: "core"` and the core is not a canvas module.
- **"A fixture board's status mark"** is a fixture the core set's own modules register, not one of this suite's
  files: the module table gives marks2d the rect, circle and text kinds, so which kinds the core build draws a
  status mark on is the implementer's layout to make; the tests hold what is drawn, not the kind. The record the
  fixture carries gives the state; the moved-states twin keeps a fixture that draws one fixed glyph from passing.
- **"Its state's glyph and word"** is both, though the status-color rule asks only for one: the criterion says
  "and". The glyph is the clean look's (`crates/deep-canvas-marks/looks/clean.json`, the look render-back draws
  in at the base), and the word is the state's name read as words, since the design gives no word list.
- **"Beside its color"** is a label wholly inside the mark's bounds or wholly outside within 16 px, with ink
  drawn in that box; "with a legend" is #392's one entry per state on screen with glyph, color and word.
- **The text snapshot** joins render-back's snapshot entries because deep-show is the binary that holds the build
  sets and the seal; pixels alone can't tell a glyph from a word. The pixel checks keep the text snapshot honest
  (the color drawn, the swatch drawn, ink in the label box).
- **"Refuse startup, naming the module"** is #305's refusal line, with a reason of its own,
  `missing_core_module`, so the refusal is the build-set rule and not an incidental missing dependency; the test
  builds leave the module out of the core set, where nothing else depends on text or look.
- **"A planted seal that lets a build without look start"** acts at startup, so it is a `--planted` argument
  (#305's convention), on the build that leaves look out. "Draws the mark with no glyph" is read on the text
  snapshot of a board that is still presented; "fails, naming the mark" is this suite's status check failing
  with the mark's item ID.

## What the base already does, which these tests don't credit

`deep-show` has the four build-set features, a registry and seal with sorted modules, a `seal_refused` line with
reasons, the `registry`, `schedule`, `fixtures` and `eval` calls and the `shuffle` and `record` scenario fields;
a cargo test (`the_published_schedule_matches_its_committed_snapshot`) already holds each set's plan equal to its
snapshot; `KNOWN_MODULES` already lists which set each named module joins; and render-back already draws a
status mark's glyph and word inside its fill, in the clean look's color (checked by hand at the base: a `rect@1`
bound to a `fail` verdict draws `#bf232b` with ink inside). But every set holds text, look, marks2d and motion,
there is no data, graph, record or sheet module, no fixture has a status binding, the snapshot carries no status
text snapshot or legend, nothing refuses a build without text or look, and neither test feature nor the planted
seal exists.

## Not tested, because no criterion asks

The `r2` and `full` sets' contents (vector #94, cells #95, scene3d's 3D and effects' operators #64 register
through the registry from the start, but none of those modules is this issue's to prove); the core check kinds
reading only the core's arrays (#99); the R6 modules and net; the kit's ledger for the new modules (#138's lane);
dark theme status colors and contrast (#392's); `module_missing` for documents that need a module a set lacks
(#305's).

## Upstream tests (the Oracle lane)

The issue's Oracle line says no upstream test covers either criterion: shuffled legal orders and which modules
each build set seals are our own rules. So the Oracle lane has nothing to run for #388, and these tests are the
local proof for both criteria.

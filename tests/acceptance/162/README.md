# Acceptance tests for #162: Lottie both ways — export a document's 2D motion, and import a Lottie file as a checked document

Written first, blind, from issue #162 (as of November 12, 2026: its Scope, its Fields, its 16 acceptance criteria and
its Proof line), its oracle map, the design sections it links and those they lean on, and the base commit `53c0e72a3`
(`53c0e72a3c36cfd5b2d8e34006770c67d0be4be6`, "Merge pull request #2356"), by a job that never saw an implementation;
none existed, and no other worktree, branch or PR was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The Oracle lane, criteria 1, 3
and 5, is in `tests/acceptance/162-oracle/`, which imports this suite's helpers.

## What was read

- The issue, live (`gh issue view 162 --repo windoliver/deepbuild`). Each test's name starts `AC<n> #162.<id>`, the
  first 8 hex digits of the SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed
  (`scripts/proof-change.mjs`, `criterionId`).
- The oracle map (`doneright/oracles/issues/162.md` in DeepBuildAI/deepbuild, branch `doneright`) and the upstream files
  it pins (its `vendor/` on that branch): the Lottie spec at `4b55957472` for criteria 1 and 3, the upstream renderer's
  test corpus at `bede03d25d` for criterion 5; the other 13 are ours ("No upstream test").
- `docs/technical-design.md`: Films and figures on the canvas (its Export bullet), Dogfooding, Who drafts it.
- `docs/canvas-primitives.md`: Export (fields, receipt, Semantics), Export: Lottie, Asset job, Asset job: Lottie import,
  Asset job: imports, Path `path@1` and its ops, What holds a document to its rules, Check input, Check input: export
  kinds, Matte, Marker, Status binding, Constraint (follow_path), Channel and key, Mask `mask@1`, Frame and group (y
  sort, passes), Paint (and its glow), Text `text@1`, Text animator and counter, Inset, Effect, Driver and the closed
  function list.
- At the base, for surfaces only: `crates/deep-show/src/main.rs` (the call list, the scenario's `planted`),
  `export.rs` (`Job::target`, `unknown_target`, #157's planted names), `query.rs` (`eval`'s `paths`, `item_value`),
  `frames.rs` and `snapshot.rs` (`eval`'s `film.glyphs`), `function.rs`, `hub.rs` (claims), `verdict.rs`;
  `crates/deep-canvas/src/show.rs` (`unreadable_handles`), `schedule/core_ops.rs`, `kinds.rs`;
  `crates/deep-canvas-effects/src/module.rs` (`pass_graph`: a group runs the shipped blur, a document's pass item or an
  fx@1 operator); `packages/hub/src/jobs.ts`, `packages/jobs/{typeset,bakes}` (the first-party job plug-ins);
  `scripts/lanes.mjs`, `scripts/public-text.mjs`, `scripts/benchmark.mjs`; and the suites `157/`, `157-oracle/`, `501/`,
  `160/oracle/` (and its `vendor/NOTICE.md`), `496/` (`lottie-reference.mjs`), `1922/`, `154/`, `1162/`, `1700/`,
  `1897/`, `430/` as patterns and, by import, for their helpers (`501`, `157`, `1922`).
- The fixture documents were each shown with `deep show` at the base to check they are documents the base presents
  (all are, with no issue), before any test was run on them.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, install and build once, then run one file at a time (each
file builds the `deep-show` feature sets it lists once, in `beforeAll`; the import's files start a real hub):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
npm run build --workspaces                                                    # the hub runs packages/cli/dist/main.js
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease cargo build --locked -p deep-hook                               # the hub won't start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 warnings.test.ts --testTimeout=600000   # AC2, AC7, AC8
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 atomic.test.ts --testTimeout=600000     # AC4 (full,test-export-guards)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 repeater.test.ts --testTimeout=600000   # AC6
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 claim.test.ts --testTimeout=600000      # AC9
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 text.test.ts --testTimeout=600000       # AC10
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 fidelity.test.ts --testTimeout=600000   # AC11, AC14
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 spin.test.ts --testTimeout=600000       # AC12
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 budgets.test.ts --testTimeout=600000    # AC13 (reference Mac; a hub)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 markers.test.ts --testTimeout=600000    # AC15 (a hub)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162 taste.test.ts --testTimeout=600000      # AC16
node node_modules/typescript/bin/tsc -p tests/acceptance/162/tsconfig.json                                 # type-check (exits 0)
```

Every `it` passes a 3,600,000 ms timeout (#501's `TIMEOUT`): a first cargo build takes many minutes. Every file but
`atomic.test.ts` builds only `full`, so after the first file the others reuse cargo's build. Temp folders are removed
after each test or file; a hub and its `deep mcp` run in a temp home under `/tmp/dh1922-*` (#1922's world) and are
stopped by their PIDs; no process is stopped by name or port. Delete `tests/acceptance/162/node_modules/.vite` after a
`--root` run.

`scripts/lanes.mjs` needs these lines (this job writes only its two folders; the implementer adds them). Every file
builds a cargo binary and exports through the GPU, and `markers.test.ts`, `budgets.test.ts` and three of the oracle
lane's files start a hub that runs tools through the supervisor, so none may share the machine with another heavy
file; `budgets.test.ts` reads the machine's load:

```js
alone.push('tests/acceptance/162/', 'tests/acceptance/162-oracle/');
timed.push('tests/acceptance/162/budgets.test.ts');
```

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; BLOCKED and INCONCLUSIVE legs
fail with a line starting `BLOCKED:` or `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Tests (and the wrong program each fails on) |
|---|---|---|---|
| 1 | `#162.ba90a515` | 162-oracle | schema.test.ts, roundtrip.test.ts (its README) |
| 2 | `#162.4fcf440a` | warnings.test.ts | 2: the document with a glow pass (`halo` running the pass item `glow`), an inset (`screen` on the 3D box `panel`) and a sound strip (`tone`) delivered with exactly one `cannot_hold` warning for each of `halo` (naming the pass), `screen`, `tone` and `panel`, none for `plate` or `back`; the same document with a status binding refused, naming `plate`, nothing written |
| 3 | `#162.6dd976de` | 162-oracle | examples.test.ts |
| 4 | `#162.b38a3ba1` | atomic.test.ts | 2: the title with #157's `test.device_loss@1` at frame 24 (a fidelity frame) stops with `device_lost` naming frame 24 and leaves out's folder empty; the title exported twice in one run and once in another, as JSON and as dotLottie, gives one SHA-256 per form |
| 5 | `#162.f8f7c065` | 162-oracle | corpus.test.ts |
| 6 | `#162.bc95e877` | repeater.test.ts | 1: 3.5 copies are four groups each holding the square, 30 u apart, opacities 100, 100, 100, 50; the twisted outline's path keyed at every export frame 12–36 (at most two keys outside), the path before the twist on the outline with its four corners |
| 7 | `#162.76f8723c` | warnings.test.ts | 1: x keyed at every export frame 0–59, linear, within 1e-4 u of `eval`'s x; a `sampled` warning on `title` naming `items/title/at/pos/0` (or `drivers/wave`); one `cannot_hold` warning on the y-sorted `stack` |
| 8 | `#162.719d85b5` | warnings.test.ts | 1: the unbound plate exports; the plate bound by its own `status` field and the plate bound in `status_bindings` are each refused, naming `plate`, with one code, nothing written |
| 9 | `#162.d05d40e6` | claim.test.ts | 4: the claim's `export` requirement on the glow title FAILs naming `halo` and its pass; outside a claim the export is delivered with that `cannot_hold` warning; with `except: ["halo"]` it PASSes listing `halo`; the spring title PASSes listing `tiles` |
| 10 | `#162.178dca43` | text.test.ts | 1: five glyph groups at the evaluated glyphs' origins at every export frame within 1e-3 u; every written gradient within 0.01 ΔEOK of the OKLab ramp accent → ink at 256 points; one warning naming glow, on `title`, `cannot_hold` |
| 11 | `#162.ec813bb5` | fidelity.test.ts | 2: the receipt's fidelity compared 20 frames, floor 40 dB, each met; planted `lottie_writer_drops_mask` FAILs export.fidelity whose first named frame is 24, every named frame a sampled one, nothing written |
| 12 | `#162.d814f153` | spin.test.ts | 2: rotation keys at every export frame 0–60, rising, 0 at frame 0 and 720 at frame 60, each within 1e-4° of `eval`'s, held at 720 after; planted `lottie_wraps_rotation` fails naming frame 16 and no frame before it |
| 13 | `#162.30ea626f` | budgets.test.ts | 3: a perf-lane task naming `#162.30ea626f`, valid against the merge base; on a reference Mac five runs after a warm-up: the 200-item, 2,000-key title's `timing.wall` < 1 s; a 1 MB import < 2 s from call to reply and < 200 MB peak resident set of the processes the hub starts for it (`judgeLimit`) |
| 14 | `#162.d1c6940c` | fidelity.test.ts | 2: the title's warnings are `[]` and its Line layer keeps its mask; `fidelity.sampled` is ⌊i × 48 ÷ 20⌋, i 0–19; planted `lottie_writer_lists_mask` fails the same judge, naming `veil` |
| 15 | `#162.eabe9bb9` | markers.test.ts | 2: markers `{cm: shrink, tm: 51, dr: 18}`, `{wait, 69, 66}`, `{done, 135, 33}`; imported back, three markers named shrink, wait and done at 599,760,000, 811,440,000 and 1,587,600,000 flicks; planted `lottie_writer_drops_markers` fails naming `wait` |
| 16 | `#162.43d9564a` | taste.test.ts | 1: the recorded taste call on exactly the check run's three pictures |

## The surface under test

`deep-show run` (one scenario line on stdin, one answer line `{"ok": true, "replies": [...]}`), with the scenario's
`planted` key for the wrong programs (as #157's suite names them; an unknown name answers `bad_input`), #157's Cargo
feature `test-export-guards` for criterion 4, and the files an export writes; for the import, a real hub with
`deep_job` over `deep mcp` (#1922's world). No new binary, subcommand or call. Names the issue or the design give are
used as given; **every name marked *(chosen)* is this job's**, taken from the design's words and shaped like the
neighbouring calls; the implementer builds exactly these, or a dispute goes to a blind redraft. Times are flicks or
the design's time literals; rates are `[p, q]`; hashes are lower-case hex.

### The scenario and the documents

`{evidence, sessions, processes, panels, docs, planted?, record?, claims?, calls}` as #501's and #1162's suites write
it: the documents are shown with `deep show` from your shell (#501's peer), or, where a status binding reads a verdict,
from the agent's tree with the agent's record holding that verdict (#1162's world; the base refuses a handle the writer
can't read). Every fixture is a `film` with a camera over its frame, a ground rect `back` and #157's look (`look-162`:
accent `#f2c230`, ink `#1b1d22`, …), made at test time. Each item has a `name`; the export writes it as the `nm` of what
it writes the item as *(chosen; README: readings)*. Fields beyond #501's and #157's films, all accepted at the base:

| Where | Fields | From |
|---|---|---|
| a mask | `mask@1 {shape: rect, box, applies_to: children}`, the curve its child; `items/veil/params/box/2` on hold keys | design (Mask) |
| path ops | `params.ops: [{trim: {start, end}}]`, `[{repeater: {copies, at: {pos}, opacity}}]`, `[{twist: {angle, center}}]`, keyed at `items/<id>/params/ops/0/<op>/<field>` | design (Path: ops); #160's suite |
| keys | `interp: {bezier: {x1, y1, x2, y2}}`, `{ease: {name: "in_out_cubic"}}`, `{spring: {freq_hz, damping_ratio}}`, `"hold"`, `"linear"` | design (Channel and key) |
| drivers | `drivers.<id> {target, expr, vars: {t: "time"}}`: `100 * sin(rad(360 * t))`, `360 * min(t, 2)` | design (Driver) |
| y sort | `group@1 {sort: "y"}` with two children whose y keys cross | design (Frame and group: y sort) |
| a glow pass | an item `glow` of kind `gpu.pass@1` (#429's form: nine taps 3 px apart added at 60%), and `group@1 {passes: [{op: "glow"}]}` | design (passes); the base runs no shipped glow in a group's passes *(chosen fixture)* |
| an inset | `inset@1 {face, size, px_per_unit, content}` with `parent` a `mark.box@1` | design's Inset fields; the kind's name *(chosen)* |
| a glow on text | `params.paint.glow {role, size}`, beside `paint.fill.gradient {kind: linear, stops: [{at, role}]}` | design (Paint) |
| text animator | `params.animators: [{units: grapheme, range: {from, to, offset, basis}, shape, mode, props: {y}}]`, offset keyed | design; #496's suite |
| status | `status_bindings.<id> {target: items/plate/params/paint/fill, source: verdict:…}`, or the rect's own `params.status: {source}` | design (Status binding: a mark's `status` field); its place in `params` *(chosen)* |
| markers | `markers.<id> {kind: section, t: "0.85s", name}`, ID and name alike | design (Marker) |
| criterion 4 | `test.device_loss@1 {frame: 24}`, `requires.modules: {"test.guards": "^1"}` | #157's test module |

### `export` with `video.codec: lottie`

The delivery form (#501): `{call: "export", doc, out, video: {codec: "lottie"}, lottie: {container: "json" |
"dotlottie", images: "embed" | "none"}}` (`lottie` beside `video`, as `pdf` and `sheet` sit *(chosen)*); the export's
frame rate is the document's. `out` is the file: `.json` for the JSON container, `.lottie` for dotLottie. Outcomes, as
#157's: `"exported"` with `receipt`; `"failed"` with `issues` (`{check: "export.fidelity", frame | frames, …}`),
nothing written; `"stopped"` with `issues` (`{code: "device_lost", frame}`), nothing written; `"refused"` with `code`,
nothing written; `"blocked"` (read as BLOCKED, never a pass).

**The receipt** adds, as read here:

| Field | Shape | From |
|---|---|---|
| `warnings` | `[{item, kind: "cannot_hold" \| "sampled", what, …}]`: `item` the item's ID (a strip's ID, or `strips/<id>`); a sampled key's entry names the channel's or the driver's target path, and the interp (`ease`/`in_out_cubic`, `spring`) | issue's `warnings: [{item, what}]`; `kind` *(chosen: what the export check fails on and what it never fails on)* |
| `fidelity` | #157's `{frames: 20, floor: {psnr_y}, psnr_y, ssim, worst_1pct}` plus **`sampled: [k]`**, the export frames compared | #157; `sampled` *(chosen)* |
| `timing.wall` | seconds from the command to the file | design (Export's receipt) |

**Refusals:** a document with a status binding, in `status_bindings` or in a mark's `status` field, is `{outcome:
"refused", code, …}` naming the bound item, the same code for both *(the code's name is the implementer's)*.

**The file:** Lottie JSON; each item's layer (or mask) has the item's `name` as its `nm`. The tests read layers by
`nm`, shapes by `ty`, properties `{a, k}` and keyframes `{t, s, e?, i, o, h?, to?, ti?}`, split positions, groups' `tr`,
`masksProperties`, `markers: [{cm, tm, dr}]` and gradient fills' `g {p, k}`, with their own reader (helpers.ts).

### Other calls

| Call | Request | Reply read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document`, `include: ["issues"]` | `outcome: "presented"`, `issues[].severity` | existing |
| `eval` | `doc`, `t`, `paths: ["items/<id>/at/pos/0", …]` | `values` (#1918) | existing |
| `eval` | `doc`, `t`, `film: true` | `film.glyphs.<item>: [{x, y}]` (#493) | existing |
| `verdict` | `claim` (a requirement `{kind: "export", target: "lottie", except?: [ID]}`) | the row: `result`, `issues` | existing; the check kind is the export module's *(its input chosen)* |

### The import (`import {from: lottie}` over `deep_job`)

- The first-party plug-in at **`packages/jobs/import`** *(chosen, as `packages/jobs/typeset` sits)*, installed with
  `deep install packages/jobs/import`; it holds the kind **`import`**, and deep_job's list names one tool of it whose
  name starts **`lottie`** *(chosen)*.
- Run: `{op: "run", kind: "import", tool, params: '{"from":"lottie","look":"generated"}', inputs: [{name: "file", path}]}`
  (`file` *(chosen)*), the file in the hub's project folder.
- Done: `{status: "done", outputs: {document: {sha256}, report: {sha256}}, receipt}` *(the two outputs' names
  chosen)*: `document`, the whole document (as `deep show` takes it), and `report`, `{issues: [{code, layer, …}]}`
  *(chosen)*, each read by hash from the hub's evidence store (`<home>/.deepbuild/evidence`). The document names its
  generated look by `look.asset` and `assets.<id>.sha256`, whose bytes are in the same store (a look@1:
  `palette`, `roles`).
- The imported document is shown with `deep show` in a `deep-show run` whose `evidence` is the hub's store. Each layer
  comes back as items named by its `nm`; a section marker as `markers.<id> {name, t}`.

### Cargo features of `deep-show`

| Feature set | What the build holds |
|---|---|
| `full` | the shipped set (existing) |
| `full,test-export-guards` | #157's test canvas module `test.guards` (existing), for `test.device_loss@1` |

## Planted programs (the scenario's `planted`)

Each is a wrong program the implementation builds, accepted in the scenario's `planted` (beside #501's and #157's
names) and reachable no other way; at the base each answers `bad_input`. Each planted test asserts this suite's judge,
or the export's own check, fails, and that a failure names what the criterion says.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `lottie_writer_drops_mask` | the Lottie writer leaves the title's mask out of the file (the masked layer has no `masksProperties`) and lists nothing | 11 | export.fidelity FAILs; its first named frame is 24, the first sampled frame the mask shows in |
| `lottie_writer_lists_mask` | the writer leaves the mask out and lists the mask item `veil` in `warnings` as an item Lottie can't hold | 14 | `veil` (the delivery is otherwise as the plain one) |
| `lottie_wraps_rotation` | the writer writes each sampled rotation wrapped into [−180, 180], an angle in that range kept as it is | 12 | frame 16 (192° written as −168°); no frame before it |
| `lottie_writer_drops_markers` | the writer writes no `markers` | 15 | `wait` |

The Oracle lane's planted mismatches are in its README.

## Fixtures

All made at test time; nothing but the README, the helpers and the tests is committed; no personal data; licences CC0.

- **The title** (`helpers.ts` `titleDoc`; AC4, AC9, AC11, AC14, AC16, and AC1 in the oracle lane): 320 × 180 at 24 fps
  for 2 s (48 export frames). `veil`, a rect mask over the whole frame whose width a hold key halves (320 → 160) at
  0.9375 s, export frame 22.5; `line`, a cubic from (40, 120) to (280, 120) stroked 24 u in ink, under the mask, its
  trim's end on a Bézier key 0 → 1 over 1.5 s and its y on one 0 → −10 over 2 s; `tiles`, a 24 u accent square at (36,
  150) with a repeater of three copies 36 u apart (opacity 1 → 0.5), turned 0° → 45° on a Bézier key over 2 s. The
  mask first cuts frame 23, which isn't a fidelity frame (0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, …), so the first
  sampled frame it shows in is 24, when the curve's right part is drawn. `eased`: the trim's key in_out_cubic, the
  turn's a spring (2 Hz, damping 0.4).
- **The extras** (AC2): the title's frame, 2 s at 24 fps with a 2 s stereo tone strip at 48 kHz; `plate` (a rect),
  the glow pass item `glow`, `halo` running it over a spark, `panel` (`mark.box@1`) and `screen` (`inset@1` on it).
  With `bind`, `status_bindings` binds the plate's fill.
- **The plates** (AC8): one rect `plate`, bound by its own `status` field, by a `status_bindings` entry, or not at all.
- **The wave** (AC7): 30 fps, 2 s; text `WAVE` at 40 u whose x the driver `wave` sets; the y-sorted `stack` of two
  squares crossing at 1 s.
- **The copies** (AC6): the tiles (3.5 copies, 30 u apart) and the knot (a 240 × 60 outline, twist keyed 0 → 90° from
  0.5 s to 1.5 s about (160, 130)), 24 fps for 2 s.
- **HELLO** (AC10): 640 × 200, 30 fps, 2 s; `HELLO` at 96 u, its animator's fifth-wide grapheme range swept by its
  offset (−0.2 → 1) lifting each grapheme 30 u in turn; the gradient accent → ink; a glow.
- **The spinner** (AC12): a square turned by `360 * min(t, 2)`, 30 fps for 2.5 s (75 frames).
- **The 200-item title** (AC13): 200 rects, ten Bézier keys each on x over 4 s (2,000 keys). **The 1 MB Lottie**: shape
  layers of 24-point filled paths on two keys, at least 1,048,576 bytes, its layer names changed per run.
- **The loading button** (AC15): 240 × 80 at 60 fps for 2.8 s (168 frames), its width keyed to shrink and grow, three
  section markers.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- AC13's runs: INCONCLUSIVE off a reference Mac (Mac15,7, Mac15,12, Mac17,10 by `scripts/benchmark.mjs` `fingerprint`),
  or not on mains power, Low Power Mode on, or the thermal state not nominal; and whenever `judgeLimit` reads the five
  runs as neither all within nor all over, or a run's load was above the core count.
- AC16: INCONCLUSIVE without the three pictures in `docs/evidence/162/` or without a recorded call on exactly them.
- Any export answering `blocked` (its fidelity reader not installed) or an import answering BLOCKED fails with a line
  starting `BLOCKED:`.

## The taste call

The check run puts `title-from-lottie.png` (a frame of the title played from its exported Lottie file by the pinned
reference renderer), `title-own-render.png` (the document's own render of the same frame) and `title-motion.apng` (a
recording of the title's motion) in `docs/evidence/162/` *(names chosen)*, attaches them to the PR and shows them in
the session. The call is recorded in `tests/acceptance/162/TASTE.json`: `{issue: 162, criterion: "#162.43d9564a",
verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>: sha256}, note?}`. This job writes
no TASTE.json and makes no picture.

## Readings where the issue and design leave a choice

- **Names across the file** (AC1, AC6, AC7, AC10–AC15): Lottie 1.0.1's only name is `nm`, so each item's `name` is its
  layer's (or its mask's) `nm`, and an imported layer's items are named by it; a test finds a layer by the item's name
  and an imported item as the outermost one of that name.
- **"Nothing written"** (AC2, AC4, AC8, AC11): out's folder, fresh per export, is left empty: no file under out's name
  or a temporary one.
- **"Naming it"** (AC2): the warning's `item` is the item's ID; the sound strip may be named `tone` or `strips/tone`.
  The 3D box under the inset is listed too, as 3D, once; the pass item `glow` may be listed as an operator.
- **A driven x** (AC7) is read from the layer's position less its anchor, split or not; "the driver's path" is its
  target (`items/title/at/pos/0`) or its own path (`drivers/wave`).
- **"Four groups, the last at half its opacity"** (AC6): the groups that hold the square; each copy's place is where its
  transform puts its origin, and its opacity its own transform's `o`.
- **"Keyed at each export frame where it changes"** (AC6): a key at every frame from 12 (the last before it changes)
  to 36, at most two keys outside; before the twist the written path lies on the outline.
- **Glyph positions** (AC10): a glyph group's position is where its transform, composed with its layer's and any group
  around it, puts its origin; the glyph's is `eval`'s `film.glyphs` origin; groups and glyphs are paired by x at frame 0.
- **The ramp** (AC10): a Lottie player draws a gradient straight between its stops in sRGB-encoded values; each written
  gradient is held to the OKLab ramp between the look's accent and ink over its whole length.
- **"Listed once"** (AC10): exactly one warning whose JSON says glow.
- **The rotation** (AC12) is the layer's `r`, our `at/rot/2` in degrees, both clockwise on a y-down frame; keys run to
  frame 60 (2 s), the span holds 0.5 s more so the 720° key is written.
- **"Imported back, the same flicks"** (AC15): each imported marker's `t` read as flicks (a whole number, or a literal
  in s, ms or frames at the document's rate); spans aren't compared, since the source's are 0.
- **The import's memory** (AC13) is the largest resident set of a process the hub started during the run; its time is
  the deep_job call's.
- **The claim's export check** (AC9): the requirement names the target as export.target@1 does (`lottie`); "lets the
  glow go" is Check input's `except: ["halo"]`; "listed" is the item named in the row, the row's echo of its own check
  input left out.

## Not tested, and why

No criterion asks: `images: none`; the export of placements and time remaps (Lottie's precomps and `tm`) beyond what
the title holds; round corners, pucker, zig zag and offset path; a bound value's text with its as-of time; a path's
ends as paths; hard drops and halos as copies; color keys in OKLab or OKLCh as linear keys; the import's `look@major`
form; easing per dimension; layer effects as issues (the corpus's effects are read only where a criterion names them).

## Not settled

- **The inset's kind name** (`inset@1`) is this job's: the design gives the Inset's fields but no kind name, and the base
  presents the document with it.
- **The glow pass** is a document's composed pass: at the base a group's passes run only the shipped blur, a pass item of
  the document or an fx@1 operator, and fx@1 has no glow.
- **The report's shape** and the outputs' names are this job's; the design says only that the import returns issues
  naming their layer and a document by hash.

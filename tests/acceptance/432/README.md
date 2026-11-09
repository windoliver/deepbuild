# Acceptance tests for #432: GPU operators — pass fusion and a warm-up at check that compiles every reachable feature set

Written first, from issue #432 (its Scope, Fields, six acceptance criteria and Proof line), its Oracle page
(`doneright/oracles/issues/432.md`), the design sections it links and those they lean on, and base commit `0c3b9d48`
("Merge pull request #1696 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion, plus one per planted twin a criterion names.

## What was read

- `docs/canvas-primitives.md`: GPU operators, as data (GPU operator; Step and the closed step list; Operator input;
  Operator output; Place in the frame; Compile, validate and cache; Compile, validate and cache: pass fusion; Operator
  cost and limits; Determinism class); Operator budgets by class; Material (one pipeline per feature set: pattern, alpha
  mode, transmission, unlit, ink; lobes); Look `look@1` (at most 32 pipelines per look); Variant; Control; Input track;
  Light policy: cascades and local shadows.
- `docs/technical-design.md`: Dogfooding; The reference Macs.
- At the base: AGENTS.md; `tests/acceptance/431/`, `429/`, `430/`, `446/`, `428/`, `424/` (`counts.compiled`), `378/`
  (the noop lane), `308/` (controls), `854/` (cold start); `crates/deep-gpu-layer/src/{main,live,view3d,effects,
  calibrate,session3}.rs`; `crates/deep-canvas-effects/src/{graph,check,module,shipped}.rs` (fields, the shipped blur's
  stages, the cost constants); `crates/deep-canvas-scene3d/src/light.rs` (material fields: `alpha_mode`, `shadow`, lobes,
  patterns); `crates/deep-canvas/src/document/mod.rs` (`controls`, `variants`); `scripts/lanes.mjs`.

**The noop lane** is `deep-gpu run --backend noop` (crates/deep-gpu/README.md; #377, #378): wgpu's noop backend, no GPU,
the same render logic, pipeline keys and frames as the default backend. "Counted on the noop lane and on the reference
Mac" is read as: the count is taken on the noop lane and on Metal, both must hold, and the Metal one counts only on a
reference Mac (Mac15,7 or Mac15,12): elsewhere the test fails `INCONCLUSIVE:` after both counts held, never passes.

What the base already does and these tests don't credit: a fade (#424) draws a depth pass of its own triangles, then its
color where depth is equal, and scene3d's `MeshOut` marks its position `@invariant`; `view3d` with `counts: true` lists
`compiled` per frame (scene3d's pipelines only, by name); `live` reports `settled` per view and a revision's
`settled_ms` and `pipelines`; `check_operator` reports `estimate_ns`; the shipped blur is two stages, `blur.x@1` and
`blur.y@1`, of 31 taps each, which group passes run (#430). There is no pass fusion, no `fuse` field (the base's operator
check refuses it as an unknown field), no warm-up of reachable feature sets, no `input` event in `live`, no variant
patch applied anywhere, no per-frame list of created pipelines naming items, feature sets and targets, no operator
pipeline count, no per-operator split of a pass, no calibration run in `live`, `use@1` resolves only pack functions,
and none of the planted names below. So these tests define the surface below.

## Run them

They build `deep-gpu` and draw on the noop backend and on Metal, so they run one file at a time, and
`scripts/lanes.mjs` needs `'tests/acceptance/432/'` added to its `alone` list beside `'tests/acceptance/431/'`. This
README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/432 --no-file-parallelism depth-equal.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/432 --no-file-parallelism fusion.test.ts
# … blur-split, product, finish, shadows, one at a time
npx tsc -p tests/acceptance/432/tsconfig.json   # type-check
```

Each file builds its binary once (`cargo build --locked --bin deep-gpu`), copies it out of `target/debug` (or
`$CARGO_TARGET_DIR/debug`) to a temporary folder and fails each test that uses it if the build failed. Each test writes
into its own temporary folder and deletes it. Delete Vitest's cache in `tests/acceptance/432/node_modules/.vite` after a
run. Timeouts are per test (30 to 60 minutes); no test reads a wall clock or gates on load or power, since no criterion
names a time.

- Pixels (AC1's fade, AC2, AC3) are drawn on macOS's Metal device: off macOS those tests fail `INCONCLUSIVE:`.
- Counts (AC1's first frames, AC4, AC5, AC6) run on the noop lane on any platform the binary builds on, then on Metal on
  macOS; AC4, AC5 and AC6 then read `INCONCLUSIVE:` off a reference Mac (above). Planted twins run on the noop lane.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--backend noop] [--planted <name>]` with its JSON-lines
protocol unchanged (one scenario `{"out", "calls"}` per line, one `{"ok": true, "replies"}` line back), the document
fields the issue and design name, fields on `live` and `check_operator`, and three planted programs. **Every name below
that the issue or design doesn't give is this job's choice**, the plainest consistent with the base.

### Documents

Scene documents as #378, #429 and #431 write them (helpers: `sceneDoc`; in `live`, #393's payload), with:

- **`fuse: "pixel_wise" | "none"`** on a pass operator (in its item's `params`), the issue's field; default
  `pixel_wise`. `none` keeps that operator out of any fused pass.
- **A composed pass calling the shipped blur:** `uses: ["blur@1"]` and a step `{"op": "use@1", "args": {"name":
  "blur@1", "src": <step ID>, "radius": <px>}}`: the shipped blur of the value step `src` gives at each pixel (that value
  written to a target the blur's passes read), as a vec4. (The design: "a step function or a shipped operator called by
  `use`".)
- **`controls`** (Control): a `toggle` with `binds` writes its value into each bound path (as the base's 2D draw path
  writes a switch's bool to `visible`): `range: [off, on]` maps it to a number (`false` → range[0], `true` → range[1]),
  `options: [off, on]` to a word. A `choice` with `variant: <set>` picks that
  set's option by name (Control: "a choice with a variant set applies the option picked … in class document from the
  input track"). Both are `class: "document"`.
- **`variants`** (Variant): `{set: {default, options: [{name, label, patch: [op]}]}}`, each patch #378's ops (`set`,
  `create`). A set whose choice has no entry applies its `default`.
- **`channels`** as at the base (`items/<material>/params/sheen/weight`); material fields as #428 and #446 give them
  (`sheen: {weight, color, roughness}`, `transmission`, `alpha_mode`, `shadow: auto | cast | none`, `pattern`, `unlit`);
  lights as #446's (`shadow: true`, `cascades: 3`, `radius`, `light_policy.shadowed`); `instance@1` as #424's.

### `live` (#379): an event, a field, and rows added

| Where | Form | Meaning |
|---|---|---|
| event | `{"frame": n, "input": {"session", "control", "value"}}` | An entry of writer `you` on that session's input track for `control`, stamped at frame n's flick (t = (n − 1) ÷ fps), so frame n draws it (Input track: with no logic and no sound, the stamp is the event's t) |
| call field | `"calibration": true` | A calibration run: every operator runs in its own pass, nothing fused (Operator cost and limits) |
| `frames[].views[]` | `"created": [{"key", "items", "feature_set", "target"}]` | Every pipeline created while drawing this frame for this session, of any kind (scene3d's, a material or pass operator's, a fused pass's, a shadow pass's): `key` its 128-bit pipeline key as 32 lowercase hex digits; `items` the item IDs it was created for; `feature_set` the name of their feature set (naming its features with the design's words: `sheen`, `transmission`, an alpha mode, …); `target` what it draws into: `"view"` for the camera's view, otherwise the shadow map or capture (any other string, e.g. `"sun/cascade 0"`). Empty when nothing was created. Pipelines warm-up compiled at check are never listed |
| `frames[].views[]` | `"operator_pipelines": n` | The operator pipelines (Compile, validate and cache: ≤ 32 per document session) the session holds as the frame draws |
| `frames[].passes[]` (`report: ["passes"]`) | `"key"`, `"operators": [{"operator", "share", "ms"}]` | On a pass that runs operators: its pipeline key, and each operator it runs in order, with its share (its declared cost × pixels over the pass's) and `ms` = that share of the pass's timed span, (end_ns − start_ns) ÷ 10⁶. An operator alone in its pass has share 1 |

"Settling" is a view row's `settled: false`, as at the base ("never while an operator draws its fallback"; Compile,
validate and cache: an item that shows before its pipeline is ready draws its fallback and the frame reports settling).
**"The first frame"** is the first frame a session's view draws (`drawn: true`); "after the first frame" is every view
row after it.

A refused session (AC4's cap) is the base's: its row's `state` is `"refused"` and `issues` holds the check's issues.

### `check_operator` (#380, #429): field added

`parts: [{"of", "steps", "fetches", "estimate_ns", "cost"}]`, in run order, on an accepted pass operator: one per pass it
compiles into. `of` is `"steps"` for a pass of the operator's own steps, or the shipped stage it runs (`"blur.x@1"`,
`"blur.y@1"`); `steps` the operator's step IDs that pass computes; `fetches` the texture reads per pixel it makes;
`estimate_ns` its cost per px; `cost` `"estimated"` (from the op table) or `"measured"` (a shipped operator's cost as its
calibration measured it). The reply's `estimate_ns` is the operator's estimate, the sum of its parts'.

### `view3d` (#378, #418)

Used as it is: `targets: ["linear"]` and `["pre_tone"]`, `capture: [0]`.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `warms_in_use_at_t0` | Warm-up compiles only the feature sets in use at t = 0 | AC4 |
| `fuses_default_options` | Warm-up fuses only the chain of each variant set's default option | AC5 |
| `warms_view_only` | Warm-up enumerates only the pipelines that draw into the view, none into shadow maps | AC6 |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.
Each test's name starts with `AC<n> #432.<id>`. Each file's header gives its fixture, numbers and wrong programs.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#432.e6a02864` | `depth-equal.test.ts` (1), its first-frame test `redraft/depth-equal.test.ts` (1) | A fade of a ball filling a 512 × 512 frame, plain and through a material operator: every pixel of the linear target 0.4 within 0.004; a doctored pixel at 0 is named missing. Every fixture document of this suite (10) opened in `live`, on noop and on Metal: its first drawn frame lists no created pipeline |
| AC2 `#432.e7e1c505` | `fusion.test.ts` (1) | grain, vignette, tint, grade over 32 colored boxes: fused vs `fuse: none` `pre_tone` within one 10-bit code on all but 115 of 115,200 pixels; live: one fused pass of the four in order, shares 0.1/0.2/0.3/0.4, each `ms` its share of the pass's span; unfused four passes of one; `calibration: true` four passes of one |
| AC3 `#432.2bdf5706` | `blur-split.test.ts` (1) | `soft` (lift, `use@1 blur@1`, dim): accepted; parts `steps`, `blur.x@1`, `blur.y@1`, `steps`, the first holding px, c, lift, the last dim, out; each ≤ 32 fetches, together > 32; blur parts `measured`, steps parts `estimated`; `estimate_ns` = Σ parts within 1e-9 |
| AC4 `#432.b131b5d1` | `redraft/product.test.ts` (2) | 181 frames at 30 fps, sheen keyed 2.9 → 3 s, both toggles at frame 121 (4 s); a second figure 0.3 → 0.6: nothing created and nothing settling after the first frame, on noop and Metal, frames 89 and 121 drawn; the cap figure admitted at 22 reachable feature sets, refused `over_budget` at 44, its `ids` only parts or their materials. `warms_in_use_at_t0`: created at frames 89 and 121 only, the cloth with `sheen`, the glass with `transmission`, the shade into a shadow map; the failure names 2.933 s and 4.000 s |
| AC5 `#432.5c39ff99` | `redraft/finish.test.ts` (2) | Four states (switches at frames 31, 61, 91) and all 36 states with nine grades: nothing created or settling after the first frame and at most 32 operator pipelines, on noop and Metal; on Metal every pass running tint, halftone or grade runs it alone; two edit orders of one revision: the same passes, keys and operators. `fuses_default_options`: first created at frame 31; the failure names night and 1.000 s |
| AC6 `#432.b107949f` | `shadows.test.ts` (2) | Sun (3 cascades), spot and point lamp over crate, leaf (mask) and pegs (instanced): nothing created and nothing settling from the first frame, on noop and Metal. `warms_view_only`: the first frame creates pipelines into shadow maps that name the crate, the leaf and the pegs, each with its target |

Proof line: "the fused chain against the unfused one" is AC2; "the product figure played live with no pipeline created
after its first frame" is AC4.

## The oracle page

| Row | Status |
|---|---|
| Blender `0a18557098` compositor `pixel_nodes` scenes and `compositor_render_tests.py` (criterion 2) | **Idea ported, not run.** Their check, runs of adjacent pixel nodes compiled into one operation against a reference, is AC2's fixture: four adjacent pixel-wise passes fused against the same passes unfused, at our bound (one 10-bit code on 99.9% of pixels), not Blender's (0.016 on 1%). The `.blend` scenes need Blender to run; no Blender runner exists here, so the oracle lane for this row stays BLOCKED with one unblock ask: a runner that renders those scenes and compares them against our output (#136). No Blender code or data is copied, so no license notice is carried |
| Criteria 1, 3–6 | No upstream test, as the page says |

## Readings where the issue and design leave a choice

- **The depth-equal pass** is a fade's color pass against its own depth pass (#424), the core's pass pair that tests
  depth for equality; a ball that fills the frame makes every pixel one where the two must meet. "No missing pixel" is
  every pixel at its fade value within 0.004 (about one 8-bit code), so a missing MSAA sample counts as missing too.
- **"Every fixture document"** is every document this suite plays (helpers: `everyFixture`), the 44-set cap figure
  excepted, since it is refused at check.
- **"Within one 10-bit code value"** is #429's reading, |fused − unfused| × 1023 ÷ max(1, |unfused|), per channel on
  `pre_tone`; "99.9% of pixels" allows 115 of 115,200.
- **Declared shares** are each operator's declared cost × its pixels over the pass's; the fixture's operators share one
  resolution, so shares are 0.1, 0.2, 0.3 and 0.4. "Checked by calibration runs" is read as: a run with `calibration:
  true` gives each operator a pass of its own; no bound between the split and the own-pass times is asserted, since the
  criterion names none.
- **"The blur's own passes"** are the shipped blur's two stages as the base names them, `blur.x@1` and `blur.y@1`;
  "its fetch limit" is a pass's 32 (Operator cost and limits). **"At its measured cost"** is asserted as the parts'
  `cost: "measured"` and the sum: no surface at the base gives the blur's measured value independently (`calibrate`
  doesn't time the blur's stages, and no calibration record is committed), so the implementer owes a note on where the
  measured value comes from.
- **The toggles' values.** The issue says a toggle switches the glass "from opaque to transmission 0.9" and the shade's
  shadow mode "from none to cast"; a toggle is a bool, so `range: [0, 0.9]` and `options: ["none", "cast"]` map off and
  on to those values (above). The shade is the scene's only mask part, so the caster it adds to the sun's map is a
  feature set nothing else brings, and the planted twin must create it at 4 s.
- **"The first frame after 2.9 s"** at 30 fps is frame 89 (t = 2.933 s); frame 88 draws t = 2.9 s exactly, where the
  sheen is still 0. "At 4 s" is frame 121.
- **The look's 32 and its refusal.** The cap counts reachable feature sets; the fixture reaches 44 through a variant set
  that sets eleven patterned materials' alpha mode (blend, mask) or unlit flag, and 22 with two options, which must be
  admitted. The refusal's code is `over_budget` (the plainest of the design's codes for a cap; the issue names none),
  its `ids` the items that add the sets: at least one, and only the parts or their materials.
- **"Swaps the tint" / "swaps the grade"** is a patch setting the operator's `steps`; the day and night tints are
  graphs of different steps, and the nine grades differ by one literal, which the key holds (key: canonical steps and
  args). **"Adds or drops a halftone pass"**: `print` creates the halftone pass and `screen` is the empty patch over a
  document that has none, so one drops what the other adds.
- **"The operators that differ"** between the 36 states are tint, halftone (present or not) and grade: each must run
  alone in its pass. That grain and vignette still fuse is the design's, not the criterion's, so it isn't asserted.
- **"Two edit orders"** are two sessions revised to the same document in two orders (a grain of another amount, and a
  `lift` pass added), the second written with its items in another order; the passes are compared by key and operators
  in the last frame each drew.
- **"Naming the option and the time"** and **"each item, feature set and time"**: the created rows carry items, feature
  set and target; the time is the frame's t; the option is the one the test switched to at that frame. The failure text
  is the test's, built from those.
- **"The shadow map and the caster"** is a created row whose `target` isn't `"view"`, with the caster in its `items`;
  across those rows the opaque, the mask and the instanced caster must each be named (the instancer or its prototype).

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- Fusion never crossing depth of field, glare, the status guard or another writer's layer (the scope); only the blur is
  crossed here, in AC3, as a composed pass's split.
- Warm-up of the feature sets kinds create implicitly (text in 3D, puffs, insets, status overlays), of light probes'
  captures, of skinned casters, and of looks a transition can bring.
- The check's order and its issues list, WGSL emission with fixed bind groups, naga's validator flags and wgpu's runtime
  checks (the Fields): the base's #429 suite covers them.
- The cost estimate taking each item's costliest reachable feature set.

# Acceptance tests for #149: drawn looks: light, paper, line profiles and drawn fills for print and painting looks

Written first, from issue #149 (its scope, fields, twelve acceptance criteria and proof line), #77 for the reference
film, #64 for the blank guard, its Oracle page (`doneright/oracles/issues/149.md` in `DeepBuildAI/deepbuild`, branch
`doneright`) and the design sections it links, at base commit `c12a65bb` ("Merge pull request #1281 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion family, one test per criterion
clause that needs its own run, plus exactly the planted twins the criteria name.

What was read:

- `docs/canvas-primitives.md`: Units and axes; Paint (fill and stroke); Paint: noise fill; Paint: stroke gradients, taper
  and wave; The cost model's class table; Look `look@1` and its rows light, paper, line profiles, drawn fills, strokes on
  surfaces; Camera `camera@1`; Effect and GPU operator: collection targets; Operator input; Export; `film.blank`; the
  status-color rule.
- `docs/technical-design.md`: Films and figures on the canvas; Look; Every task carries its own budgets and the
  reference Macs; Dogfooding; the parity suite's rule on goldens (`regression_only`).
- At the base, only for how surfaces work: AGENTS.md; `tests/acceptance/{430,429,417,424,422,374,389}/` (READMEs,
  helpers, some tests); `crates/deep-gpu-layer/src/{main,marks2d,film,golden,compare,view3d}.rs`;
  `crates/deep-canvas/src/{main.rs,grammar/unit.rs,document/check.rs}`; `crates/deep-marks-render/src/lib.rs`;
  `crates/deep-canvas-marks/looks/*.json`; `crates/deep-codecs/README.md`; `benchmarks/canvas.mjs`,
  `benchmarks/budgets.json`, `scripts/benchmark.mjs`.

What the base already does and these tests don't credit: a look@1 with `basis: drawing`, `lines`, `fills` and `ground`
kinds it barely reads; #430's group passes; `film2d`, `layers`, `view3d`; `golden` with `oracle: "hash"`; the unit grammar
converting `1/300fw` given a frame, though every caller hands it an empty one, so a document's `fw` is refused. 2D writer
layers ignore a `camera@1`. None of light, tooth, age, profiles, ink, wash, spatter, offset, the hatch fields, collection
targets or the noise fill exists.

## Run them

They build `deep-gpu` and drive the GPU, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs this
folder in its `alone` list beside `tests/acceptance/430/` and `429/`. This README is the instruction; the implementer
makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/149 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/149    # type-check
```

Each file builds what it drives once (`cargo build --locked --bin deep-gpu`, and `deep-canvas-render` or `deep-canvas`
where named), copies it to a temporary folder and fails each test that uses it if the build failed. `helpers.ts` sets
Vitest's timeouts (`vi.setConfig`), so they hold under any root. Each test writes into its own temporary folder and
deletes it. Delete Vitest's cache in `tests/acceptance/149/node_modules/.vite` after a run.

- Everything but AC7, AC8's refusal and the budgets file check draws on Metal: off macOS a test fails `INCONCLUSIVE:`,
  never passing.
- No test takes an outside input, so none reads `BLOCKED` as a verdict of its own. The one `BLOCKED` here is the blank
  guard's, which is asserted.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The goldens

AC1 compares pixel hashes, so the files hold hashes, not pictures. `goldens/<family>.<2d|3d>.f<n>.golden.json`, one per
fixture frame (`f0`, `f30`, `f60`), each `{"fixture", "fingerprint", "pixels"}`, where `fingerprint` is `golden`'s own
`{os, gpu, driver, wgpu}`.

The implementing run records them once, on a reference Mac, after every other criterion passes:

```sh
DEEP_149_RECORD_GOLDENS=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/149 families.test.ts -t "match their goldens"
```

- That run writes only goldens that are missing, refuses off a reference Mac and on a blank frame, and ends
  `INCONCLUSIVE:`: a recording run proves nothing. Run the suite again without the variable.
- A missing golden reads `INCONCLUSIVE:`, never a pass. A golden from another fingerprint reads `INCONCLUSIVE:` naming
  what changed; to move one, a person deletes the file and records again.
- These goldens were set by the implementation, so by the design's rule each is `regression_only`: it gates later changes
  and proves no other criterion. AC2 to AC11 hold the fields to outside answers, and AC12 is the look of them.
- `goldens/` doesn't exist until then. The golden files are the one thing under this folder the implementing run writes,
  beside `TASTE.json`.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged, the
document and look fields the issue names, more fields on calls that exist, and three planted programs.

### The look and the document

The fields are the issue's, in a look@1 passed inline as `look`. `fixtures/` shows each in use. What the issue leaves
unsaid, these tests fix:

- **Naming a look's fill or line.** The design's "`fill: a named fill from the look`" and "`line: a named line from the
  look`" are `paint.fill: {"fill": name, "role": role}` and `paint.stroke: {"line": name, "role": role}`. `role` is the
  ink it draws in; a named line gives the width unless the stroke states one. A named fill's `kind: flat` takes `offset`
  and `pressure` too.
- **In 3D**, a mark (`mark.box@1`, `mark.sphere@1`, `mark.cylinder@1`, `mark.line@1`) takes the same `params.paint` and a
  `paint.fill.noise`, and a `basis: drawing` look lights it from its own `light`, with no Light item. What a fill looks
  like on a surface is the implementer's; only AC1's golden and guard, AC5 and AC12 read it.
- **The camera in 2D.** A 2D document's envelope `camera` names a `camera@1` with `projection: orthographic`,
  `target: [x, y, 0]` in u and `view_width` in u. `film2d`, `layers` and the ground draw through it: a world point lands
  at `(p − target) × (W ÷ view_width) + (W, H) ÷ 2`. A document with no camera draws as it does at the base.
- **`rim`** takes a list of up to two. Each entry adds `dir: deg`, its own direction, in the look light's convention:
  0° right, 90° up, counter-clockwise on the screen, so `dir: 135` is the upper left. AC11's left and right edges fix
  this.
- **`tooth.from`** is a gray PNG, named by SHA-256 and given through the call's `assets`, as `view3d` takes them. Its
  value ÷ 255 is the tooth at `depth: 1`; one image pixel spans `scale` px at zoom 1; its origin is the world's and it
  repeats.
- **`profile.taper_out: f`** narrows the width linearly in arc length to 0 over the last `f` of the path.
- **`back.lamps`** names 2D items. A lamp's place is its evaluated center (a `circle@1`'s `center`, by a channel), its
  color its fill's role, and it draws nothing of its own. Lamps light each collection in a look's `transmission`.
- **A collection target** `{"collection", "output", "resolution": "full" | "half", "mips"}` holds its pressure in red
  (0 where no item covers it). In a group, a pass reads it as #430's group passes read their inputs.
- **The noise fill** is `paint.fill: {"noise": {…}}`, in a 2D or 3D paint, and a channel may key
  `…/paint/fill/noise/evolution`.
- **Status roles** in a ramp take #374's form, `status.pass`, refused with `status_color_unbound`.

### `layers` (#385, #430): fields added

```json
{"call": "layers", "doc", "look", "t"?, "by": ["gpu_layer"], "float"?: true, "ground"?: true, "assets"?: {sha: path}, "target_costs"?: true}
```

- `ground: true` adds a row `{"layer": "ground", "dim": "2d", "drawn": {"gpu_layer": {"png", "f32"?}}}`: the look's ground
  alone, paper with its tooth and age, at `t`. Its `f32` is as a layer's: RGBA little-endian, rows top-down, premultiplied,
  sRGB-encoded, at 10 bits or better.
- A 2D layer's side holds the look's light: rims, line weight, cast shadows and the lamps. A stroke's coverage is its alpha.
- `target_costs: true` adds `"target_costs": [{"collection", "output", "width", "height", "format", "mips", "declared_bytes", "bytes"}]`,
  one per target drawn: `declared_bytes` from its declaration, `bytes` from the device's own count (#379).
- A read of another writer's collection answers a refusal: a `code`, naming the collection, and no `layers`.

### `film2d` (#417, #430): fields added

```json
{"call": "film2d", "doc", "look", "fps"?, "frames", "from"?: n, "hash"?: true, "capture"?: [n], "export"?: {"codec": "h264"}}
```

- `capture` adds `"final": sha256` to each listed frame's row (absolute frame index), `<sha>.png` under `out`: the frame's
  surface, ground and writer layers composited, as `view3d`'s `final` is.
- `export` encodes the frames played through `deep-codecs`' encode tool and adds `"export": {"file": sha256, "codec":
  "h264", "frames": n}`, `<sha>.mp4` under `out`.
- It draws the look's ground and light, and honors a camera, as `layers` does.

### `view3d` (#378)

Unchanged, for a look@1 with `basis: drawing` and the fields above. The tests use `doc` (a path), `look`, `size`, `fps`,
`from`, `frames`, `capture`, `targets: ["final"]`, and read `final` and `pixel_hash`.

### `golden` (#380, #422): one oracle added

`{"call": "golden", "store", "fixture", "png", "oracle": "pixel_hash"}` reads only `<store>/<fixture>.golden.json`,
`{"fixture", "fingerprint", "pixels"}`, and keeps no picture. In order:

1. The blank guard on the snapshot alone: `{"verdict": "BLOCKED", "reason": "blank"}`, whether or not a golden exists.
2. No golden: `{"verdict": "BLOCKED", "reason": "no_golden", "fingerprint", "numbers": {"pixels"}}`.
3. Another fingerprint: as `oracle: "hash"` does, `INCONCLUSIVE`, `reason: "environment_changed"`, `changed`.
4. `numbers.pixels`, the SHA-256 of the RGBA8 rows, against the file's `pixels`: `PASS` or `FAIL`.

### `deep-canvas parse unit` and `deep-canvas-render check`

- `parse unit` takes `"frame": [w, h]`, the context for `fw` and `fh`, and answers `value: {num, den}` as it does.
- The document check converts `fw` and `fh` against the document's `size`, in a look's fields and in a paint's
  (`paint.stroke.width`). `deep-canvas-render check` answers `lowered` as it does, its literals converted, and
  `lowered_look`, the look with its own literals converted against that document.

### `benchmarks/canvas.mjs` and `benchmarks/budgets.json`: AC10's reports

Two modes, each printing one JSON line last, as #417's do, from a release `deep-gpu`, 30 warm frames then 300 timed, five
runs after a warm-up:

- `drawn-frames`, task `canvas-drawn-frames`, targets `{"frame_gpu_p95_ms": 10, "frame_cpu_p95_ms": 4}`:
  `{"task", "fingerprint": {…, "build": {"profile": "release"}}, "runs": [{"families": {<family>: {"2d": {"fixture":
  "tests/acceptance/149/fixtures/families/<family>.json", "size": [1920, 1080], "frames": [{"gpu_ms", "cpu_ms"}]}, "3d":
  {…}}}}]}`.
- `paper-cost`, task `canvas-paper-cost`, targets `{"paper_added_gpu_ms": 0.2}`: the paper family's 2D film with its
  paper and with `ground: {"kind": "flat"}`: `{"task", "fingerprint", "runs": [{"fixture":
  "tests/acceptance/149/fixtures/families/paper.json", "paper": {"frames": […]}, "flat": {"frames": […]}, "paper_hash",
  "flat_hash"}]}`, each hash a frame's `pixel_hash`.

Each task in `budgets.json` has `command: ["node", "benchmarks/canvas.mjs", <mode>]`, `margin: 0.5`, `limits: {}`, and
an `initialReason` naming #149, so the perf lane compares it with the merge base.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `ink_fill_flat` | Every `kind: ink` fill draws its role flat; every other kind is untouched | AC1 |
| `draws_black` | At the base a 3D view's frames are black; `film2d` now honors it too | AC1 |
| `rim_keeps_first` | A `rim` list keeps its first entry and drops the rest | AC11 |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped. Each
test's name starts with `AC[n] #149.<id>`.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #149.71fb5e48` | 1: each family, 2D and 3D, golden hash, guard first | `families.test.ts`: eleven families at three frames each through `golden`: none blank, none missed, no fixture name in the program. Twins: `ink_fill_flat` changes `ink`'s pixels, leaves `wash`'s, and misses naming `ink`; `draws_black` reads `BLOCKED` `blank` in 2D and 3D. |
| `AC2 #149.c0138bef` | 2: paper through a 9,100 px dolly and a 5× zoom; 2 code values | `paper.test.ts`: each link of the chain within 0.5 px on every patch, and the sum along the chain; every adjacent pair of the 240-frame push, every pixel, at its place on the page. |
| `AC3 #149.92bebcd4` | 3: pressure 0.3 reads the tooth | `pressure.test.ts`: the stroke's alpha against smoothstep(tooth − 0.7) within 1/255 on an image tooth the test wrote. |
| `AC4 #149.fc5501aa` | 4: line weight; a taper under 1 px | `weight-profile.test.ts`: width by alpha integral, 1.6× at weight 0.6 within 2%; each column under 0.95 px one row wide at alpha = width within 5%. |
| `AC5 #149.75d75ba2` | 5: seek equals play for every field | `../149-redraft-ac5/`, the blind redraft that replaced `seek.test.ts` (Swapped redrafts, below). |
| `AC6 #149.9ffe6b6a` | 6: a collection target | `targets.test.ts`: a pass writes the pressure target out: 0.6 on the collection's stroke, 0 on the same writer's other stroke, another writer's and the page. Twin: a read of `theirs` is refused, naming it. |
| `AC7 #149.f455f94d` | 7: "1/300fw" | `units.test.ts`: the rational 32/5 from the grammar; 6.4 exactly in a document and a look at 1920; the same literals at 1280 follow the document. |
| `AC8 #149.1c3a3068` | 8: the noise fill | `noise.test.ts`: 1,440° equals 0° and 720° doesn't; seek equals play and the loop closes; AC2's chain through a dolly. Twin: `status.pass` in the ramp refused, naming the item; a data role checks. |
| `AC9 #149.e2b5abff` | 9: the shadow play | `shadow-play.test.ts`: L(0) = 0 and L(0.5) = L(1) / 2 within 1/255 in linear light for each collection; shadows fall away from a walking lamp; the description checks, seek equals play, and an H.264 MP4 with one sample a frame. |
| `AC10 #149.affd8de8` | 10: budgets | `budgets.test.ts`: both tasks in `budgets.json` through the lane's validator; 10 and 4 ms p95 per family; paper under 0.2 ms. A target's device bytes: `../149-redraft-ac10/`, the blind redraft that replaced that test (Swapped redrafts, below). |
| `AC11 #149.c911c0df` | 11: two rims | `rim.test.ts`: both edges, 3.5 px within 1 px, mirror within 1 px, nothing within 45° of straight down. Twin: `rim_keeps_first` fails, naming `rim 1 at 20°`. |
| `AC12 #149.583b9b35` | 12: shown to you | `taste.test.ts`: below. |

Proof line: "the dolly and zoom recordings with the paper's reprojection error" is AC2's printed errors and AC12's
recording; "each field's measured cost" is AC10's reports, whose per-family frames name each.

## Swapped redrafts

Two tests here failed on every correct program, so their blind redrafts replaced them, on the owner's call on PR #1563:

- AC5's `seek.test.ts`: `fov` runs across the wider side, so in four 3D fixtures (`ink`, `spatter`, `hatch`, `strokes`) the
  only moving item sits above the frame and "the film moves" can't hold. `../149-redraft-ac5/` keeps its moving items in
  frame by arithmetic.
- AC10's target bytes in `budgets.test.ts`: Metal allocates in 16 KB pages, so a 4,147,200 B target holds 4,161,536 B at
  least and "no more than" can't hold exactly. `../149-redraft-ac10/` allows the meter's 1%.

`helpers.ts` and the fixtures are as written.

## The taste call

`taste.test.ts` writes, from one run, the canvas's own frames to `docs/evidence/149/`: `<family>-2d.png` and
`<family>-3d.png` for each family at frame 30, `paper-dolly.png` (frame 300 of `paper-move.json`), `paper-zoom.png` (frame
840, at 5×), `shadow-play.png` (3 s in), byte for byte the renderer's PNGs, and `paper-dolly-zoom.apng`, an animated PNG
of 61 frames of the move at 10 frames a second. It prints each SHA-256. Show them to the owner, attach them to the PR, and
record the one call in `tests/acceptance/149/TASTE.json`:

```json
{"issue": 149, "criterion": "#149.583b9b35", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"<name>": "<sha256>", …}, "note": "…"}
```

`screenshots` names all twenty-six. No file, or one made on other pictures, is `INCONCLUSIVE:`; `looks_wrong` fails. No
other test reads these pictures or the call.

## The oracle page

The page was read. It pins one test, for criterion 4, and says the other eleven have none.

| Row | Status |
|---|---|
| Vello `vello_tests/tests/basic.rs:414-428`, `filled_vertical_hairline_rect{,_2}.png` | **Ported as behavior**, in `weight-profile.test.ts`. The rule (a mark thinner than a pixel keeps that pixel, alpha scaled by its coverage) is held on our 2D renderer at every width from 0.95 to 0.05 px of a tapered profile, 0.5 and 0.2 px among them. The snapshots aren't compared: they hold a filled rect in `REBECCA_PURPLE` at alpha 0.5, and the criterion's mark is a profile. The straddling case, `_2`, isn't asserted: on a pixel boundary a true thin mark and a 1 px mark give the same pixels, so it can't tell them apart. |
| Criteria 1 to 3, 5 to 12 | No upstream test, as the page says. |

## Readings where the issue and design leave a choice

- **The families.** The issue's title and Fields sections give them: light, paper, line profiles, and the drawn fills ink,
  wash, spatter, offset and hatch, then collection targets, the noise fill and strokes on surfaces. A family is one row
  a fixture proves; the planted "family drawing its fill flat" needs fills split out.
- **One-argument smoothstep.** `smoothstep(x)` is `smoothstep(0, 1, x)`, `t²(3 − 2t)` with `t = clamp(x, 0, 1)`, the
  closed list's step. So at pressure 0.3 the highest peak has coverage 0.216, and a tooth at or under 0.7 has none.
- **"Paper value" under a push.** It's read at a place on the page: each pixel reprojected from the frame before. On one
  screen pixel a correct paper's tooth crosses the pixel, which is its place changing, not its value.
- **"A steady push"** is the camera's `view_width` falling at a constant rate.
- **Reprojection error** is the offset that best aligns a patch, in the later frame's px, against the earlier frame
  reprojected by the camera's own numbers. No frame is compared with a renderer's reference.
- **"Its lower quarter"** is the quarter of the disc centered on straight down: the sector within 45° of it. Of the
  readings this is the smallest region, so it fails the fewest programs. A rim of the crescent `max(0, n·l)` reaches into
  it, so a rim has to stop short, as the criterion says.
- **"Each 3.5 px wide"** is the integral of the rim's coverage across the contour on its own ray; the 1 px it's held to is
  the tolerance the criterion gives its symmetry, since it states none for width.
- **Line weight's direction.** `l` points toward the light. The design's `1 + weight × max(0, −n·l)` then keeps the near
  side's width.
- **The light a collection takes** is its linear pixels less the same pixels with `lamps: []`, at unchanged geometry, so
  neither a lamp's falloff nor a color rule is assumed. The transmission test runs with no `cast`.
- **"Moves the shadows with it."** A shadow falls away from its lamp, so the test asks only which side of the fox it lies
  on, at each end of the lamp's walk. How far it reaches is `cast.length`'s, which the criterion doesn't state.
- **The reference film.** #149 says #77 lists a coloured shadow play of a fable; #77's body doesn't name one at the base.
  `fixtures/shadow-play.json` is this suite's, an original staging of the fox and the crow.
- **Exports to MP4** is the box structure and the sample count. #501's export guards are that issue's.
- **"No film-specific code"** is a search of `crates/` and `packs/` for the fixtures' own names. It catches a named
  special case and nothing subtler; AC5's kinds and the fixtures' unrelated subjects carry the rest.
- **The showpiece budget at 1080p** is the class's 10 ms GPU and 4 ms CPU. The class says full screen on the reference
  Mac; the criterion says 1080p, and the fixtures are 1920 × 1080.
- **Under load** (one-minute load over 1 a core) a timing reads `INCONCLUSIVE:`, whatever it reads.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof). They are in the issue's
fields or scope and in no acceptance criterion:

- Each tooth kind, age mark, `edge`, `zoom: fade_fine` and `anchor: page | sheet | frame` beyond drawing and seeking equal
  to play in a fixture; what each looks like is AC12's.
- `light.relief`, `elevation`, `spatter.where: shadow`, `hatch.follow: field`, a rim's `toward: <ID>`.
- A pass's other target outputs (`color`, `coverage`, `height`), `mips`, and `strokes` drawing every stroke on export or
  half while moving.
- The "can never" refusals beyond AC6's and AC8's: `basis: physical` with `light`, a status role in a line or fill, a pass
  reading a target after status colors.
- Status colors staying above light and paper. It's in the fields' "can never" and in no criterion.
- A third `rim` entry refused.

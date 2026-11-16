# Acceptance tests for #2031: lights in a 2D group, point lights and an ambient level, summed in linear light and pure in t

Written first, blind, from issue #2031 (its scope, its eight acceptance criteria and its proof line), the design sections
it links and those they lean on, and base commit `52aa05fd3` ("Merge pull request #2729 …"), by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion clause that needs its own run, plus exactly the planted wrong programs the criteria name. The issue's
oracle page says no upstream test checks these criteria, so there is no oracle lane.

Out of scope here, as the issue says: shadows from outlines and a sun (#2032), a light's `kind` and `height`, normal
pages on images, lights in an indexed look, and lights shared with a 3D scene.

## What was read

- The issue, live (`gh issue view 2031`).
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; The path grammar; The status-color rule; Honest
  numbers; The cost model; Text `text@1`; Rect `rect@1`; Paint (fill and stroke); Paint: shade; Frame and group
  `frame@1`, `group@1` (the `light` and `unlit` fields and their semantics) and its y sort, parallax, draw order, blend
  modes and passes; Status binding.
- `docs/technical-design.md`: 2D marks and paint; Films and figures on the canvas; the parity suite ("From R2, the
  canvas core's fixtures form a parity suite …"); Dogfooding; Tests written first.
- At the base, only to learn how surfaces are driven: AGENTS.md; `tests/acceptance/467/` (README, helpers, two tests);
  `160/` (helpers, `seek-play.test.ts`); `1636/` (README, helpers, two tests); the helpers of `465/`, `1653/`, `385/`,
  `190/` and `1662/`; the READMEs of `373/`, `385/`, `430/` and `239/`; `crates/deep-gpu-layer/src/{main,marks2d,film,
  groups,budget}.rs`; `crates/deep-marks-render/src/{lib,layer,raster}.rs`; `crates/deep-canvas-marks/src/scene.rs`
  (status marks); `scripts/{lanes,benchmark,canvas-kit}.mjs`. No expected value comes from them.

## What the base already does, which these tests don't credit

`window2d`, `layers` and `film2d` (with `from`, `hash` and `gpu_ms`) draw 2D documents on the GPU layer's device;
`raster`, `check` and `path` answer on every platform; status marks draw after every writer layer with their legend at
the top right. No code reads `light` on a group or `unlit` on an item: a lit group draws as an unlit one, `path` refuses
a group without parallax (`ref_unresolved`), and none of the planted names below exists (`bad_input`).

## Run them

Every file builds `deep-gpu` or `deep-canvas-render` and most draw on the GPU, so they run one file at a time.
`ac7-unlit-fixtures.test.ts` also builds both binaries at the merge base, and `ac8-budget.test.ts` judges a GPU budget.
The implementer adds these lines to `scripts/lanes.mjs`; this README is the instruction, and this job edits nothing
outside its folder.

```js
// #2031's files each build deep-gpu or deep-canvas-render and draw on the GPU; ac7 also builds both at the merge base,
// and ac8 judges the lights' GPU budget on the reference Mac.
alone.push('tests/acceptance/2031/');
timed.push('tests/acceptance/2031/ac8-budget.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/2031 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/2031    # type-check
rm -rf tests/acceptance/2031/node_modules/.vite
```

- **Build.** Each file builds what it drives once (`cargo build --locked --bin <bin>`, #467's `useBin`) and copies it out
  of the target folder, honoring `CARGO_TARGET_DIR`; a failed build fails each test that uses it. AC7 also exports the
  merge base's tree with `git archive` into `<target>/acceptance-2031-base/src-<rev>` (about the checkout's size, kept
  for the next run of the same merge base) and builds `deep-canvas-render` and `deep-gpu` there into
  `<target>/acceptance-2031-base/target`, a cold build the first time.
- **Platform.** Frames draw on macOS's Metal device: AC1 to AC4, AC5's frame pair, AC7 and AC8 fail `INCONCLUSIVE:` off
  macOS, never passing, and a `deep-gpu` answer `unsupported_platform` does the same. AC5's light-list pair and AC6 run
  anywhere (the issue's "Spark for the evaluated light list, the refusals and the CPU reference values"; the CPU
  reference values are this suite's own f64 closed forms).
- **Timing.** Only AC8 reads a time; it is INCONCLUSIVE wherever the perf lane can't judge one (README: Readings).
- **Isolation.** Temporary files go under the OS temp folder and are deleted; AC7 keeps the merge base's tree and build
  under the target folder. `BASE-FAILURE.txt` holds the run at the base.

## The surface under test

**No new binary and no new call.** The criteria are entered through the document fields the issue lists and the
surfaces the base already has. What the issue leaves open is fixed below, each as the closest thing the base has for the
same kind of observation.

### Documents

Built in `helpers.ts`: `{format: 1, id, profile: "figure", title, description, size, budget: {class: "figure"}, layers:
{main}, items}`, items `{id, kind, layer, name, order, params, parent?, at?}`, with #391's `transport` and `channels`.
Every call takes the shipped look `clean`, whose status map the window's status marks draw from; its role `ground` is
#ffffff, the white of every white rect and light here, and `accent` and `focus` are colored roles. No text holds a digit
or a number word, and every ID is free of spaces.

| Field | As the tests write it |
|---|---|
| a lit group | `params.light: {ambient?, lights?: [{at: [x, y], color: role, energy, range}]}` on a `group@1` |
| no lights, no ambient | `params.light: {}` |
| unlit | `params.unlit: true` on a `text@1`, read from params as an item's `draw_order` and `z` are |
| a light driven by t | f32 channels, linear keys, targeting `items/<group>/params/light/lights/<k>/at/0`, `…/at/1` and `…/energy` (the path grammar's list index and nested keys) |
| a status badge | a `rect@1` with no paint, whose `items/<id>/params/paint/fill` a status binding gives; its source a verdict handle, pinned `pass` by the call's `states` |
| a light in a status role | `color: "status.pass"` |

### `deep-gpu run`: `window2d` (macOS): the frames of AC1 to AC4

`{"call": "window2d", "doc", "look": "clean", "states"?}` → `{"window": sha256, "layers": [{"layer", "path"}]}` as at the
base: the document as the app's window shows it, each writer layer on the path `layers` names, then the status marks and
their legend; the PNG is named by its SHA-256 in `out`. A lit group's layer draws its lights here, on whatever path the
implementation gives it. `--planted <name>` takes this suite's names (Planted programs).

### `deep-gpu run`: `film2d` (macOS): AC5's frames and AC8's times

`{"call": "film2d", "doc", "look": "clean", "fps", "from", "frames", "hash": true}` → `{"frames": [{"frame", "gpu_ms",
"pixel_hash", …}], …}` as at the base (#417's, with #430's `from` and `hash`): each row's `frame` its absolute index, the
lit group drawn with its lights at that frame's time.

### `deep-canvas-render path` (every platform): a lit group's evaluated light list

As #160's and #467's (`{doc, item, times, look?, planted?}` → `{ok, frames}`, the check first, one frame per time, in
order, in one process). With `item` a `group@1` that has `light`, each frame is:

```json
{"t": flicks, "light": {"ambient": number, "lights": [{"at": [x, y], "energy": number, …}, …]}}
```

the group's light list evaluated at that time. The tests read each light's `at` and `energy` as numbers and the list's
length, and compare the whole `light` object between a play and a seek, so its other fields (`color`, `range`, any
more) may take any form, the same each time.

### `deep-canvas-render check` (every platform): the refusals

`{"doc", "look": "clean", "planted"?}` → `{"ok", "issues": [{"code", "severity", "ids", "path", …}], …}` as at the base.
Each refusal is an issue of severity `error`, so `ok` is false:

- **17 lights on one group**: an error that names the group (its `ids` hold the group's ID, or its `path` is
  `items/<group>` or under it) and reads the count and the cap: the text `lights: 17, cap: 16` in one of its strings,
  or `"lights": 17` and `"cap": 16` as fields of one object inside it, such as `"actual": {"lights": 17, "cap": 16}`.
- **A lit group inside a lit group**: an error that names the inner group, the same way.
- **A light in a status role**: an error whose `path` is the light's, `items/<group>/params/light/lights/<k>`, or under
  it (such as `…/color`), or whose `ids` hold that path.

Codes are the implementer's and aren't asserted.

### AC7's surfaces: `deep-canvas-render raster` and `deep-gpu run` `layers`, `window2d`

As at the base: `raster {out, doc, look, t, states, readings, store}` (Vello CPU), `window2d` and `layers {…, by: ["gpui",
"gpu_layer", "vello_cpu"]}`, compared by the SHA-256 of each PNG, each refusal by its code and path, and each layer's
draw path.

### Planted programs

| Where | Name | The wrong program | Criterion |
|---|---|---|---|
| `deep-gpu run --planted` | `light_linear_falloff` | A light's reach is `1 − d ÷ range` inside its range | AC1 |
| `deep-gpu run --planted` | `light_encoded_sum` | Each light's term is encoded on its own and the encoded values are summed, then clamped | AC2 |
| `deep-gpu run --planted` | `light_default_ambient_zero` | A lit group that names no `ambient` takes 0 | AC3 |
| `deep-gpu run --planted` | `light_every_child` | A lit group lights every child, `unlit` items and status marks included, so the badge the window shows darkens | AC4 |
| `deep-gpu run --planted` and `path`'s `"planted"` | `light_stale_list` | The evaluator keeps the light list of the frame before: a played frame takes the list of the frame drawn before it | AC5 |
| `deep-canvas-render check`, `"planted"` | `light_accepts_seventeenth` | The check lets a 17th light on one group through | AC6 |

Each is reachable only there and only for this proof; any other value stays `bad_input`. The names are snake_case, as
the base's planted names are.

## Criteria to tests

IDs are `#2031.` and the first 8 hex digits of SHA-256 of each criterion's text, as its `- [ ] ` line reads after that
prefix. Each test's name starts with `AC[n] #2031.<id>`, and the file that carries a criterion quotes it in full.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #2031.39426810` | 1: one white light over a 512 × 512 white rect against the CPU f64 closed form; the planted linear falloff | `ac1-falloff.test.ts` (2): the window of the fixture, every pixel's R, G and B within 1 code of the closed form at its centre and alpha 255. Twin: `light_linear_falloff` reads 188 within 1 code at pixel (355, 255), where the test's form gives 198, and the check fails naming `pixel (355, 255)`. |
| `AC2 #2031.b71a6207` | 2: two lights of 0.25 each read 137 alone and 188 together; the planted encoded sum | `ac2-sum.test.ts` (2): the test's form gives 137, 137 and 188 at pixel (128, 64); each light alone reads 137 and both 188 there, within 1 code. Twin: `light_encoded_sum` reads 255 within 1 code with both, and the check fails naming `pixel (128, 64)`. |
| `AC3 #2031.f59a759e` | 3: `light: {}` draws white at 137, removed at 255; the planted default of 0 | `ac3-default.test.ts` (2): every pixel of the rect within 1 code of 137 lit and of 255 with the group's `light` removed. Twin: `light_default_ambient_zero` reads 0 within 1 code and fails the check against 137. |
| `AC4 #2031.fd03b852` | 4: an `unlit` text and a status badge keep their pixel hash; a white rect reads 137; the planted light-every-child pass | `ac4-unlit.test.ts` (2): over the badge's and the label's bounds, the SHA-256 of the window's pixels is the same with ambient 0.25 as in the twin with no `light`, and every pixel of the sheet is within 1 code of 137. Twin: under `light_every_child` the badge's bounds hold less light than in the twin, and the check fails naming `badge`. |
| `AC5 #2031.4cb41821` | 5: 8 lights driven over 6 s: seeking equals playing at 1, 3 and 5 s; the planted stale list | `ac5-seek-play.test.ts` (4): `path`'s light list at frames 30, 90 and 150, each sought in a fresh process, equals the play's, and every played frame's `at` and `energy` are their channels' values; `film2d`'s played frames 30, 90 and 150 hash apart and each sought frame hashes as played. Twins: `light_stale_list` makes a seek differ from the play on each surface, the failure naming frame 30, 90 or 150. |
| `AC6 #2031.0ee07497` | 6: 17 lights refused reading `lights: 17, cap: 16`; a lit group in a lit group and a status-role light refused, named; the planted check | `ac6-refusals.test.ts` (2): 16 lights with a plain group inside pass with no error; 17 are refused by an error naming `lamps` that reads the count and the cap; a lit `tray` in the lit `lamps` is refused naming `tray`; a light in `status.pass` is refused naming `items/lamps/params/light/lights/1`. Twin: `check` takes `light_accepts_seventeenth` and the 17-light judgement fails on its answer. |
| `AC7 #2031.270a96f9` | 7: every 2D fixture already in the repo draws byte-identical to the merge base | `ac7-unlit-fixtures.test.ts` (1): every file under a `fixtures/parity/2d/` folder in the merge base's tree, drawn at 0 and 1 s by the merge base's binaries and the checkout's with the same inputs: every `raster`, `window2d` and `layers` picture the same SHA-256, every refusal the same, every layer's draw path the same. A fixture the merge base draws no picture of is INCONCLUSIVE. |
| `AC8 #2031.416073b6` | 8: 16 lights over a 1920 × 1080 lit group under 1 ms of GPU time a frame | `ac8-budget.test.ts` (1): one run, its reading printed: the lit and plain sides' first frames hash apart. Then, on a reference Mac at rest only, five runs judged against 1 ms by the perf lane's `judgeLimit`: FAIL fails, anything but PASS is INCONCLUSIVE. |

Proof line: "the planted linear falloff, encoded sum and light-every-child pass shown failing first" are AC1's, AC2's and
AC4's twins; "then the closed-form match, the refusals and the seek-equals-play hashes" are AC1's first test, AC6's first
test and AC5's frame test.

## Readings where the issue and design leave a choice

- **"A frame" and "reads"** are the app's window, `window2d`, read back at 1 px a unit: the document as a person sees it,
  with the status marks a badge needs. "Reads code c within 1 code" is each of R, G and B within 1 of c.
- **White** is the role `ground` of the shipped look `clean`, #ffffff, the only white role it has; a light's color is that
  role too. White decodes to exactly 1 in linear light, so the closed form needs no color term.
- **The closed form** (helpers `whiteLit`) is the issue's, in f64: d from the light's `at` to the pixel's centre (x + 0.5,
  y + 0.5) at 1 px a unit; reach `(1 − (d ÷ range)²)²` for d < range, else 0; white × (ambient + Σ energy × reach),
  clamped to 1, encoded once with the sRGB curve, × 255, rounded.
- **"At d = 100 px"**: with the light at the rect's centre (256, 256), no pixel centre lies at exactly 100 px; pixel
  (355, 255), whose centre is 99.5 px right of the light and half a px above it, is the nearest on that axis, and there
  the form gives 198 and a linear falloff 188, the criterion's pair.
- **"Two lights that each give a white pixel 0.25"**: lights 60 u either side of pixel (128, 64)'s centre with range
  100 and energy 625/1024 (0.6103515625, exact in f32), so each gives (1 − 0.6²)² × 625/1024 = 0.25 exactly.
- **"Names no lights and no `ambient`"** is `light: {}`, and "draws it at 255" is within 1 code at every pixel of the rect.
- **AC4.** "A status badge" is a status mark: a rect whose fill a status binding gives, drawn by the window after every
  writer layer. "The fixture with no `light`" is the same document with the group's `light` removed. Both documents
  hold a three-stop gradient rect outside the group so that the writer layer takes the GPU layer with or without the
  light: otherwise the unlit text would be drawn by GPUI in one and by the GPU layer in the other, and its hash would
  differ for reasons the criterion doesn't name. "Its pixel hash over its bounds" is SHA-256 of the window's RGBA bytes
  inside the item's box (the badge's `box`; the label's `box` at its `at.pos`), and "darkens the badge" is less summed
  R, G and B over those bounds than in the fixture with no `light`. The lit group has `lights: []`, as the criterion
  names only its ambient. The legend draws at the top right, clear of every box read.
- **AC5.** "By playing" is one process from frame 0 in order at 30 fps; "by seeking" is a fresh process opened at the
  frame with nothing drawn before it (`film2d`'s `from`; `path` with that one time), as #160's and #430's suites read
  them. The evaluated light list is `path`'s, since `path` already answers a group's evaluated parallax per frame; its
  values follow their linear channels within 1e-3 u (`at`) and 1e-4 (`energy`), a check that the fields are "drivable
  by t", as the scope says. "Naming the frame" is a failure that starts `frame 30:`, `frame 90:` or `frame 150:` and
  names the seek.
- **AC6.** "Reads `lights: 17, cap: 16`" accepts that text or the two numbers as fields of one object in the issue.
  "Naming the light": a light has no ID, so it is named by its path, the path grammar's list index. The documents that
  must be refused differ from the accepted one only in what is refused, so a check that refuses every lit group, every
  nested group or every light fails the first test.
- **AC7.** "Every 2D fixture already in the repo" is the parity suite's 2D area: the design's "the canvas core's
  fixtures form a parity suite … which must still draw the same", which the repo files by area under
  `fixtures/parity/<area>/`, `2d` being the 2D one. "Already in the repo" is the merge base's tree, and a fixture there
  that names a `light` is left out and printed. Each is drawn with what it needs and nothing it decides: the look `clean`
  where it binds status (its roles are clean's), else a role map giving each role it names its own color and `ground`
  white; every status source pinned `pass`, every reading 7, and a store of its suite's `fixtures/` files named by their
  SHA-256 (a mark set's image there). "A frame" is every picture the surfaces draw of it, so a regression on any draw
  path shows. At this base every one of the eleven draws at least one picture; one the merge base can't draw at all
  can't be judged and is INCONCLUSIVE.
- **AC8.** "16 lights cost" is the lit side's median `gpu_ms` over 120 frames at 60 fps less the plain side's (the same
  document with the group's `light` removed), in one process, as #465's suite reads a feature's cost, read as 0 when
  negative. `tick`, a small rect outside the group that moves every frame, keeps both sides drawing every frame.
  `film2d`'s `gpu_ms` is an upper bound (it holds the submit and the wait for the device's report), which the difference
  cancels on both sides. The lights sit on a 4 × 4 grid, range 400, energy 0.5, so most of the 1920 × 1080 group is
  within several. The timing counts only where scripts/benchmark.mjs's `judgeLimit` passes the machine (a reference Mac,
  on mains, Low Power Mode off, thermal state nominal) and the load is within the cores; the debug build is timed, as
  #465's is, since it is GPU time.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- A light whose color is a literal color, refused at check naming the light (the scope says so; the criterion names only
  a status role).
- `energy`'s default of 1 and `ambient`'s range 0..1; drivability by t of `ambient`, `color` and `range` (AC5 drives
  `at` and `energy`).
- Lit groups on Vello CPU (`raster`), the goldens' renderer: no criterion says a lit group draws its lights there.
- `kind`, `height`, suns, occluders and normal pages (#2032, #2053).

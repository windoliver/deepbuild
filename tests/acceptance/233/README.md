# Acceptance tests for #233: math@1, familiar math-film words for objects, layout, animations, eases, plots and planes

Written first, blind, from issue #233 (`gh issue view 233 --repo windoliver/deepbuild`), its oracle page
(`doneright/oracles/issues/233.md` and `cases/233.json` in `DeepBuildAI/deepbuild`, branch `doneright`), the design and
base commit `5aa64f71` ("Merge remote-tracking branch 'origin/main' into worktree-github-issue-233-a38b6d"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). The oracle page's upstream tests, ported, are in
`tests/acceptance/233-oracle/`.

What was read:

- `docs/canvas-primitives.md`: Pack: math@1 math-film words (the fields, the rate-function mapping, `aliases: {word →
  {target, renamed_from}}`, the stated conversions, "a parameter the primitives can't honor is refused with a fix",
  "number_line, axes and number_plane expand to a `scale@1` and an `axis@1` per axis … a path per axis with its ends …
  vector@1 labels placed onto the axis's ticks; polar_plane to circle@1 rings, path rays and labels; matrix and table to
  a frame grid (Auto layout) with `around` brackets or rules between tracks"); Pack, Recipe, Pack: kinds in any pack;
  Scale and encode (ticks on 1, 2 and 5 × 10^k, entering and leaving by opacity); Auto layout; Channel and key (key
  interps `ease {name, params}`, the pulse modifier and its shapes, exp_decay's renormalised equation); Cue list
  `cues@1`.
- `docs/technical-design.md`: The canvas core, Dogfooding, the proof and goldens rules.
- At the base, to learn the call shapes only: `tests/acceptance/142/`, `222/`, `226/`, `433/`, `490-oracle/`, `505/`,
  `412/`; `crates/deep-show` (`run`, `packs.rs`, `familiar.rs`, `kinds.rs`' word lookup, `deep show`'s `expansions`);
  `crates/deep-canvas/src/document/packs.rs` (`check_aliases`) and `expands.rs` (`drawn`); `crates/deep-marks-render`
  (`geometry`: sub-paths, `box`, an axis's `ticks`); `crates/deep-canvas-motion/src/doc.rs` (the pulse modifier);
  `packs/familiar-1.0.0`, `packs/verbs-1.0.0`.

## What the base already does, which these tests don't credit

`deep-show run` installs packs from folders, expands recipes at check into the `deep show` reply's `expansions`, and
answers deep_kinds' `word` op from a pack's `aliases` (`{word, target, conversion, pack, renamed_from?}` or `{word,
code: "no_match"}`). The pack check takes an alias only as `{target: name@major, conversion, renamed_from?}` and never
asks whether anything holds the target. `deep-canvas-render geometry` answers any item's drawn sub-paths and box and an
axis@1's ticks; `deep-motion eval` evaluates channels with ease interps and pulses. There is no `packs/math-1.0.0`, no
`math.*` kind, no planted name below, and no task `canvas-math`.

## Run them

```sh
npm ci                      # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/233 --no-file-parallelism --testTimeout=600000 <file>
node node_modules/typescript/bin/tsc -p tests/acceptance/233/tsconfig.json   # type-check (exits 0)
```

Each file builds what it drives once, in `beforeAll` (`cargo build --locked`, honouring `CARGO_TARGET_DIR`):
`deep-show` with `--no-default-features --features full`, `deep-canvas-render`, `deep-motion`; `ac11-budgets.test.ts`
builds `deep-gpu` only when the machine can judge a timing. The files build cargo binaries, so they run one at a time:
`scripts/lanes.mjs` needs `'tests/acceptance/233/'` in its `alone` list and `tests/acceptance/233/ac11-budgets.test.ts` in
`timed` (this job writes only this folder; the implementer makes those edits). Node built-ins and vitest only. A run with
`--root` leaves Vitest's cache in `tests/acceptance/233/node_modules/.vite`; delete it.

## The surface under test

The issue names the pack, its words, recipes, fields, conversions and the planted programs, but no call shapes. These
tests use the calls the base has and define the smallest surface they need. **Every name below that neither the issue
nor the design gives is this job's choice, marked *(chosen)***; the implementer builds exactly these, or a dispute goes
to a blind redraft.

### The pack

A first-party pack, folder `packs/math-1.0.0`, installed as `deepbuild/math@1.0.0`, offered to each scenario beside
`deepbuild/verbs@1.0.0` (`packs/verbs-1.0.0`, which the animation words map to) as `packs: [{id, dir}]`, and named by
documents as `packs: ["deepbuild/math@1.0.0"]`. Recipes are kinds `math.<word>@1`: the issue's recipes by their names
(`math.axes@1`, `math.plot@1`, `math.riemann@1`, `math.number_line@1`, `math.polar_plane@1`, `math.table@1`,
`math.matrix@1`, …) and the objects as the upstream class names in snake case *(chosen)*: `math.square@1`,
`math.circle@1`, `math.dot@1`, `math.rectangle@1`.

### Documents

Figures (`profile: figure`, `transport.span` 1 s) as your shell sends them (`deep show`, no `id`, no `layers`), at 1920
× 1080 u unless said (1080 × 1920 for criterion 4); 1 u = 1 px at 1x; a figure holding vector@1 items names `requires:
{modules: {marks2d, vector}}`, as #505's do. Each instance takes the upstream parameter
names and values (angles in radians where upstream takes radians), with these choices:

- `math.plot {axes: <math.axes instance ID>, f: <expression in x, our closed function list>, x_range?}` *(chosen: the
  `axes` input, upstream's `axes.plot(f)`)*; f written `"x^2"`.
- `math.riemann {plot: <math.plot instance ID>, dx, input_sample_type}` *(chosen: the `plot` input, upstream's
  `axes.get_riemann_rectangles(graph, …)`)*; its x range is the plot's.
- Layout words as params of an object *(chosen)*: `to_corner: "UR"` or `{corner, buff}`, `to_edge: "UP"` or `{edge,
  buff}`, `move_to: [x, y, z]` in math@1 units; directions are the upstream named constants as strings (`UP`, `DOWN`,
  `LEFT`, `RIGHT`, `UL`, `UR`, `DL`, `DR`).
- `math.table {rows: [[string]], row_labels: [string], col_labels: [string], lines: inner | outer | both, h_buff?,
  v_buff?}`; strings, as upstream's Table takes *(chosen)*.
- `math.matrix {entries: [[vector@1 ID]]}`: IDs of the document's own vector@1 items (the issue's "vector ID per
  entry").
- `math.polar_plane {azimuth_units: degrees, azimuth_step: 12}` with nothing else labels its rays (the criterion says
  it draws labelled rays; upstream's add_coordinates is no param of the issue's).

### Reading the expansion *(chosen, from the base's own shapes)*

The `deep show` reply's `expansions` rows (`{instance, kind, pack, key, derived: {id → item}, channels, …sections}`)
give each instance's derived items (instance `ax`'s rows are `ax` and `ax.…`). The **drawn form** a test hands to
`deep-canvas-render geometry`, which expands no pack, mirrors the base's `expands::drawn`: each expanded instance
replaced by its derived items, each row's channels and other sections merged into the document's, every item put on
one layer `main`, and `packs` dropped.

### Reading the drawing *(chosen)*

From `geometry {doc, item, t, store?}` per derived item: `subpaths` (`{closed, verbs, points}`), `box` (`[x, y, w, h]`,
geometry only) and, for an axis@1, `ticks` (`{value, opacity}`). A **tick mark** is a straight open sub-path at most 60
u long across its axis's line; a tick's place is its mark's place along the axis, and its value comes from the axis's
shown ticks (opacity > 0) in order. An **axis line** is the longest straight line along the axis. A **label** is a
derived text@1 or vector@1 item, read by its box centre and its text (a text@1's `params.text`, a vector@1's
`params.alt`); number labels with no typeset vectors are text@1 in the `math` role. A **bar** is a closed axis-aligned
rectangle; a **rule** a straight open segment; a frame@1's own layout box, which `geometry` answers whether it paints
or not, is never a rule or a bracket.

### An alias to an ease *(chosen form)*

The issue widens an alias's target to "an `ease@1` entry with its parameters". Its form is a key interp's own:
`"target": {"ease": {"name": "sigmoid", "params": 10}}` (params also `{k: 10}`, as the base reads ease params), and
deep_kinds' `word` answers it as `target`. A kind target stays `name@major`.

### Refusals

A parameter with no primitive is refused: the `deep show` outcome is `refused`, with an error issue at
`items/<instance>/params/<parameter>` whose `fix` names the parameter. A pack check that refuses an alias answers
`install_pack` `refused`, an issue naming the word (its path `aliases/<word>` or its text).

### deep_kinds *(chosen readings)*

ShowCreation is answered with Create's `target`, `conversion` and `pack`, a non-empty `renamed_from`, and the word
Create in the answer. `add_updater` is `{code: "no_match", …}` whose text names the driver and the bake routes (the
words `driver` and `bake`). The rate-function words are answered (no `code`): the ease words with their ease target,
the pulse words naming `pulse` (and `pause`, `wiggle`), the key words naming their keys.

### `deep-show run`: scenario `planted` values added *(chosen names; each reachable only there, never by an environment variable or any other input)*

| Value | The wrong program | Criterion |
|---|---|---|
| `math_axes_ticks_as_marks` | math.axes keeps a rule mark set (marks@1) of ticks from computed columns instead of an axis@1's tick rule | AC2 |
| `math_keeps_y_up` | math@1's conversion keeps y up (math y + becomes u y +, so UP lands at the bottom) | AC4 |
| `math_number_line_drops_excluded` | math.number_line drops `numbers_to_exclude` | AC8 |
| `math_expands_each_frame` | the pack expands its instances again each frame; the extra node that runs names the recipe (`math.axes@1`, `math.plot@1`) | AC11 |

As #433's twins of familiar@1 are (`crates/deep-show/src/familiar.rs`), these may be twins of the pack's manifest or
of the expander, applied only when the scenario names them.

### Test packs (fixtures/packs, installed with `install_pack`)

| Pack | What it is | Criterion |
|---|---|---|
| `test233/mathwords@1.0.0` | one recipe `mathwords.dot@1`; aliases Dot → `mathwords.dot@1` and Ghost → `mathwords.ghost@1`, which neither the pack nor the build holds | AC10 |
| `test233/matheases@1.0.0` | aliases smooth → `{ease: {name: sigmoid, params: 10}}` and wobble → `{ease: {name: wobble_in_out, params: 3}}`, no build's entry | AC13 |

Each test also installs the pack less its bad word, which must pass, so the refusal is the word's.

### Budgets (AC11)

`benchmarks/budgets.json` gains *(chosen)* the task `{id: "canvas-math", command: ["node", "benchmarks/canvas.mjs",
"math"], targets: {math_over_hand: 1.05, frame_expansions: 0}, margin: 0.5, criteria: ["#233.f4f81b7b"],
initialReason: "… #233 …"}`, which `scripts/benchmark.mjs`'s `validateBudgets` accepts against the merge base's
file. The counters are `eval`'s `nodes` (#222's).

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `fixtures/positions.json` | seven objects placed by layout words on 1080 × 1920 u, each with its box, worked out by hand from the stated conversions and the upstream defaults (Square side 2, Circle radius 1, Rectangle 4 × 2, Dot radius 0.08, edge buff 0.5) | AC4 |
| `fixtures/packs/mathwords-1.0.0`, `matheases-1.0.0` | the test packs above | AC10, AC13 |
| `fixtures/parabola-golden.json` | **not in this commit**: the golden (below) | AC1 |
| `reference.ts` | the upstream rate functions' equations, re-expressed in TypeScript (MIT source; no library installed) | AC5 |

### The golden (AC1)

"A stored golden Parabola, rendered once outside the repo": this job chose its form as positions, not a picture, so
the 1 px comparison needs no image diff. `fixtures/parabola-golden.json` is `{"made": {library, commit, by, when,
how}, "frame_px": [1920, 1080], "ticks": [{"axis": "x" | "y", "value", "px": [x, y]}], "curve": [[x, y], …]}`. To make
it, outside this repo, with the upstream math-film library at the oracle page's pin (a6d5cc02b4): build its Axes with
x_range [−3, 3, 1], y_range [0, 9, 3], x_length 8, y_length 5 at its default 16:9 frame (8 units high) and plot x²
on it; write each tick mark's centre (`get_center()` of each tick of `x_axis.ticks` and `y_axis.ticks`, with its
value) and at least 601 points of the graph (`point_from_proportion(k / 600)`), each converted to px by px = (X +
frame_width / 2) × 135, py = (4 − Y) × 135. Until that file is committed AC1 fails `BLOCKED`, naming it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with `AC<n> #233.<id>`.

| Criterion | File | Tests |
|---|---|---|
| AC1 `#233.b6a28e06` | `ac1-parabola-golden.test.ts` (1) | ticks x −3 … 3 and y 0, 3, 6, 9 drawn; then every tick and the curve within 1 px of the golden, both ways; BLOCKED without it |
| AC2 `#233.3d899ebc` | `ac2-axes-ticks.test.ts` (2) | 2 scale@1, 2 axis@1, no marks@1; x domain keyed [−3, 3] → [−5, 5]: the derived x axis's ticks equal a hand-written axis@1's at k/20 s, k = 1 … 20, an entering tick fading; `math_axes_ticks_as_marks` fails naming math.axes@1 |
| AC3 `#233.1d713f1c` | `ac3-riemann.test.ts` (1) | 4 bars, heights 0.015625, 0.140625, 0.390625, 0.765625 within 1e-9 through 810 u per y unit |
| AC4 `#233.ca1d4667` | `ac4-to-corner.test.ts` (2) | to_corner(UR) 67.5 u from the right and top within 0.5 px, and the fixture within 0.5 px; `math_keeps_y_up` fails it, first naming ur_square |
| AC5 `#233.a6357ff6` | `ac5-rate-functions.test.ts` (1) | the 13 words answered; ease targets the issue's, evaluated as key interps; pulses and keys as the issue maps them; each within 1e-12 of the upstream equation at 1,001 points |
| AC6 `#233.8747d6f5` | `ac6-refused-parameter.test.ts` (1) | the plot presents; with `use_vectorized` refused at its path, the fix naming it |
| AC7 `#233.a838a9eb` | `ac7-deep-kinds.test.ts` (1) | ShowCreation = Create's mapping + rename; add_updater no_match naming driver and bake |
| AC8 `#233.1fb6242f` | `ac8-number-line.test.ts` (2) | 7 ticks, 6 labels none at 0 each within 0.5 px of its tick's x, arrowhead apex at +3; the plant fails naming numbers_to_exclude |
| AC9 `#233.5c072eb1` | `ac9-planes-tables-matrices.test.ts` (3) | 12 rays at 30° steps with labels 0° … 330°; 5 inner rules, no border; matrix entries on column centres, inside both brackets |
| AC10 `#233.1cae712c` | `ac10-aliases.test.ts` (2) | ShowCreation's alias; deep_kinds from the field alone (a copy with the entry moved); Ghost refused naming the word |
| AC11 `#233.f4f81b7b` | `ac11-budgets.test.ts` (2) | nodes per frame match the hand-written twin's, `math_expands_each_frame` fails naming the recipe; the task, then frame_budget against the twin on a reference Mac (else INCONCLUSIVE) |
| AC12 `#233.d8298507` | `ac12-taste.test.ts` (1) | four PNGs from `eval` `pixels`, SHA-256 printed; TASTE.json on exactly these, else INCONCLUSIVE |
| AC13 `#233.2163815c` | `ac13-ease-aliases.test.ts` (2) | smooth → sigmoid(10) with conversion; math@1 installs clean; wobble refused naming the word |

## Readings where the issue and design leave a choice

- **exponential_decay (AC5).** The issue maps it to exp_decay(0.1), and the design states exp_decay as (1 − e^(−x/τ))
  ÷ (1 − e^(−1/τ)); the upstream equation, 1 − e^(−t/0.1), differs by up to about 4.5e-5. AC5 holds the mapped ease to
  the upstream equation divided by 1 − e^(−10), the renormalisation the design states. Held to the raw equation, no
  program that maps to exp_decay(0.1) as the issue says could pass within 1e-12.
- **"no tick mark set" (AC2)** is read as no marks@1 among math.axes' derived items.
- **The math@1 unit** is the frame's short side ÷ 8 (135 u at both 1920 × 1080 and 1080 × 1920), as stated.
- **Tolerances.** The criteria's own (1 px, 0.5 px, 1e-12) are kept; AC3's exact heights are judged within 1e-9 y units
  of drawn u in f64.
- **AC10's target "Create"**: the alias's target may be the word Create or Create's own target; either way deep_kinds
  answers ShowCreation with Create's resolved target.
- **AC10's pack check** refuses a target neither the pack nor the build holds (`mathwords.ghost@1` is both). The base's
  #412 fixture pack `words` maps to core kinds (`circle@1`), which a "the pack holds" reading would refuse; this suite
  doesn't decide that.

## The taste call

`ac12-taste.test.ts` writes `axes-parabola.png`, `number-line.png`, `polar-plane.png` and `riemann-bars.png` to
`$TMPDIR/deep-233-shots/` and reads `tests/acceptance/233/TASTE.json`: `{issue: 233, criterion: "#233.d8298507",
verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {name → sha256}, note?}`. This job records no
call.

`BASE-FAILURE.txt` is the one run at the base.

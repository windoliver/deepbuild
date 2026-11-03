# Acceptance tests for #221: placement by relation, beside, on a frame edge, or aligned with another item

Written first, from issue #221 (its Scope, its Fields, its seven acceptance criteria and its Proof line: "A positions
figure (nine dots, each labelled `next_to(dot, DOWN, buff=0.2)` over a background rectangle) and a quadratic-formula
figure's labels, built as documents, with render-back boxes in the receipt"), its Oracle page
(`doneright/oracles/issues/221.md` in `DeepBuildAI/deepbuild`, branch `doneright`) with the upstream file it pins, the
design sections it names and those they lean on, and base commit `960045da` ("Merge pull request #1027 …"), by a job
that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

**Disclosure.** The worktree was clean when this job started. Partway through, uncommitted edits for #221 appeared in
it (`git status`: changes under `crates/deep-canvas`, `crates/deep-canvas-marks`, `crates/deep-canvas-vector`,
`crates/deep-marks-render`, `packages/contracts/canvas-registries.json`, and an untracked
`crates/deep-canvas-marks/src/relations.rs`). This job didn't open those files. One probe of `deep-show run` with a
`registries` call, from a binary built in the worktree after those edits had started, printed a `constraint@1` row
with that work's kit rule names and planted entry names. Nothing here was taken from it: this suite names no kit rule,
and its two planted entry names (`beside_converges`, `beside_reads_previous_frame`) were chosen before the probe and
differ from the ones it printed. The base run (`BASE-FAILURE.txt`) ran on a clean `git archive 960045da` outside the
worktree, built with its own target folder.

## What was read

- The issue, read live with `gh issue view 221`, and its Oracle page, with the file it vendors:
  `doneright/oracles/vendor/manimgx-cfd33af5aa/tests/unit/test_mobject.py` (the module docstring; `Transforms`,
  266–356; `TestBox`, 359–402; `PERPENDICULAR_EDGES` and `test_next_to_leaves_buff_between_the_two`, 405–439;
  `test_to_edge_puts_the_box_buff_in_from_the_frames_edge`, 459–468).
- `docs/canvas-primitives.md` at the base: Units and axes (28: 2D in u, y down, origin top left; the transform order
  "subtract the pivot, scale, shear, rotate, add the position"); Document envelope (291; 301: `safe: f32, u = 24`);
  Item and kind (321: `at`, "`at` also takes `place`, `align` and `fit`, and `pivot` takes a box point"); Item and
  kind: relations (373, every field and its semantics: box points from evaluated bounds at t in the parent's space,
  geometry only; `beside` with side, gap 16, align center; `edge` with margin = safe, "moving only along that edge's
  axis, or both for a corner"; `onto` with point = c; `align` ≤ 2, along one axis; `at.pos` adds after the relation;
  `relation_cycle` naming the chain; "It can never … read an earlier frame"); Render-back (937); Registry and seal
  (1037) and Registry and seal: registries (1077: a kit that admits a planted entry refuses the seal, naming the
  registry and the entry); Registries and closed lists (1244; rows 1265–1267: relation kinds and constraint kinds are
  `constraint@1`, declared by the core, filled by canvas modules; box points closed: determinism); Text `text@1`
  (1382); Vector and formula `vector@1` (1813); Channel and key (5261); Constraint (5401: "Every entry passes the
  constraint kit at the seal: it runs after every read it declares, with a fixed op count and no loop; seeking to 50
  random times equals playing, bit for bit; and a two-item cycle through it is refused at check, naming the chain.
  The kit's planted entries, one that iterates to convergence and one that reads its own output from the previous
  frame, must fail").
- `docs/technical-design.md` at the base: The canvas core (1050) and its module table's marks2d row (1063:
  "placement by relation (`at.place`, `at.align`, `at.fit`) as `constraint@1` entries, and box points"; R2
  relations); Dogfooding (2523); the parity suite and "a linked test counts only by what it asserts on our output"
  (2543); Tests written first (2554).
- At the base: AGENTS.md; `tests/acceptance/398/` (README format, `helpers.ts`, `geometry` with `parts`, the store),
  `391/` (the JSON-lines convention, channels keyed on `items/<id>/at/pos/<k>`), `373/` (`check`, `raster`,
  `geometry`), `200/` (`deep-show run`, `registries`, `--planted kit_admits_all:<registry>`, the `seal_refused`
  line), `488/` (`deep_show` and the `determinism` call), `387/` (`eval` nodes and their results), `371/`, `389/`;
  `crates/deep-marks-render` (`deep-canvas-render`: `check`, `geometry`, `raster`; geometry at t = 0 only, no box
  for text, rect or circle marks), `crates/deep-canvas/src/document/transform.rs` (`at` vectors, `place` and the
  rest refused there), `crates/deep-canvas-marks/src/{main,layout}.rs`, `crates/deep-show` (`registries`,
  `render_back`, `determinism`), `scripts/lanes.mjs`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/221 --no-file-parallelism
npx tsc -p tests/acceptance/221/tsconfig.json   # type-check (exits 0)
```

Each file builds what it drives once, in `beforeAll`: `cargo build --locked --bin deep-canvas-render` (`beside`,
`edge`, `pivot`, `cycle`, `offset`, `proof`) or `cargo build --locked --bin deep-show --no-default-features
--features r2`, copied out under its own name (`registry`, `seek`), honoring `CARGO_TARGET_DIR`; every test of a file
fails when its build fails. The files build cargo binaries, so they run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/221/'` added to its `alone` list (this job writes only this folder; the implementer makes that
edit). Every `it` passes an explicit timeout (`TIMEOUT`, 30 min), as the other `deep-show` suites do. PNGs, the SVG
store and evidence folders go under the OS temp folder and are deleted. Node built-ins and vitest only. Vello CPU
draws the rasters, so nothing needs a GPU. A run with `--root` leaves Vitest's cache in
`tests/acceptance/221/node_modules/.vite`; delete it.

## The surface under test

The issue names no code API, so these tests extend the surfaces #373, #398, #200 and #488 left, add no subcommand
and no call, and read nothing else. **Every name below that the issue or design doesn't give is this job's choice**,
the smallest surface consistent with the design and the base; the implementer builds exactly these, or a dispute goes
to a blind redraft.

### Documents

The design's envelope as #373's and #398's tests write it (`{format: 1, id, profile: "figure", title, description,
size, transport?, layers, items, channels?, safe?}`), items `{id, kind, layer, name, order, params, at?}` with
`rect@1` (`box`, `radius`, `paint`), `circle@1` (`center`, `r`, `paint`), `path@1` (`d`, `paint`), `text@1` (`text`,
`font: body`, `size`, `paint`; no `box`, so it is as wide as its run) and `vector@1` (#398: `src` by sha256 from the
request's `store`, `size`, `colors`, `alt`). Channels are #391's: `{target: "items/<id>/at/pos/<0|1>" |
"items/<id>/at/scale/<0|1>", type: "f32", keys: {ID → {t: "<s>s", value, interp: "linear"}}}`. The new fields, as
Item and kind: relations writes them:

| Field | As the tests write it |
|---|---|
| `at.place` | `{beside: ID \| "ID#part", side?, gap?, align?}`, `{edge, margin?}`, `{onto: ID \| [x, y], point?}` |
| `at.align` | `[{to: ID, side: n \| s \| e \| w \| cx \| cy}]` |
| `at.pivot` | the box point `"sw"` |

A deep_show document (`seek.test.ts`) is #488's agent form: no `id` and no `layers`, the layer stamped from the
writer.

### `deep-canvas-render check {"doc", "look", "store"}` (`cycle`, and every test's `expectClean`)

Unchanged in form (#373). A relation cycle is an error issue `{code: "relation_cycle", severity: "error", ids}`
whose `ids` hold every item of the chain and no item outside it.

### `deep-canvas-render geometry {"doc", "item", "store", "t"}` (`beside`, `edge`, `pivot`, `offset`, `proof`)

As at the base (#373's `subpaths`, #398's `parts`), and:

- `t` (flicks, a JSON integer; 0 when absent): everything the answer holds is evaluated at `t`, channels and
  relations applied. At the base `geometry` evaluates at 0 whatever `t` says.
- `box: [x, y, w, h]`: the item's evaluated bounds at `t` in its parent's space (here the document's), geometry only
  (a stroke's width, a halo, a drop and a glow don't count), for every 2D item: a rect, a circle, a path, a text, a
  vector. For a curve it is the tight box of the curves (TestBox), never the control points.
- `points: {n, ne, e, se, s, sw, w, nw, c → [x, y]}`: the nine box points of `box` (y down: `n` the top side's middle,
  `sw` the lower left corner).
- A document the check refuses answers `{"ok": false, "code": <its first error's code>}`, as at the base.

### `deep-canvas-render raster {"out", "doc", "look", "store", "t"}` (`beside`, `edge`, `proof`)

Unchanged (#373). The tests read only where ink is: ink-role pixels (gray, r = g = b, below 200) and accent-role
pixels (blue above red by more than 40) near an item's box must exist and lie inside that box within 1 px. This is
how "render-back boxes" are held to the pixels: the boxes `geometry` reads back are where the items draw.

### `deep-show run` with the r2 build set (`registry`, `seek`)

- `{"call": "registries"}` (#200's listing): a `registry` row `constraint@1` with `owner: "core"`, `fill:
  ["module"]`, `kit: [{rule, message}]` (at least four rules), `entries` holding `beside`, `edge`, `onto` and `align`,
  each `{module: "marks2d", origin: "first_party", since, digest, kit: {verdict: "PASS", rules: [one per kit rule,
  each PASS]}}`, and `planted` holding **`beside_converges`** (a beside that iterates to convergence, its op count
  changing with the gap) and **`beside_reads_previous_frame`** (a beside that reads its own place from the previous
  frame), each `{name, value, result: {verdict: "FAIL", rules: [...]}}` whose result names it and has a failing
  rule with a message, the two failing on different rules.
- `--planted kit_admits_all:constraint@1` (#200's startup argument): the seal refuses, one line `{"ok": false,
  "code": "seal_refused", "reason": "kit_admits_planted", "registry": "constraint@1", "entries": [...]}` naming both
  planted entries, exit 2. Without it the r2 build seals (exit 0).
- `{"call": "deep_show", …}` presents the placed document (`outcome: "presented"`), and `{"call": "determinism",
  "doc", "display_hz": 60, "at_times": [50 flicks]}` (#488) answers `{outcome: "compared", frames: [{t, play: {pixels,
  nodes}, seek: {pixels, nodes}}]}`. Each placed item has at least one node (`item` its ID) in every frame, and a node
  result of each item placed against the moving ball differs across the 50 times: its evaluated position is in its
  nodes' results.

## Fixtures

Written by this job before any implementation ran (`fixtures/`):

| Fixture | What it holds |
|---|---|
| `formula.svg` | `x = y` in a 120 × 40 viewBox: `t-x` an O of two cubics (tight x 4..28, its control points reaching 0 and 32), `t-eq` two bars, `t-y` a Λ of lines; at `size` [240, 80] its tight box is 200 × 60 from (8, 8) of its origin |
| `quadratic.svg` | the quadratic formula's parts `num-b`, `pm`, `sqrt`, `disc` (a cubic hump), `bar`, `den` (40..100 × 52..76) in a 240 × 80 viewBox |
| `beside-formula.json` | AC1: `ball` (circle, center 200, 540, r 50, a 6 u stroke) keyed by `ball-x` 0 → 900 over 4 s and `ball-y` 0 → −300 at 2 s → 200 at 4 s; `formula` (vector@1) `beside: ball, side: e, gap: 24, align: center` |
| `beside-text.json` | AC2: `head` "Momentum of the cart" (20 characters, size 32, at 100, 300) and `unit` `beside: head` with every default |
| `edge-title.json` | AC3: `title` (size 48) at `pos` [200, 0], `edge: n`, margin the default |
| `pivot-sw.json` | AC4: `card` rect [100, 200, 80, 40] and `arch` path `M 300 400 C 280 300 420 300 400 400 Z`, each `pivot: sw, scale: 2`; `grow` rect [500, 300, 60, 30] `pivot: sw` with its scale keyed 1 → 2 over 2 s |
| `cycle-two.json`, `cycle-three.json`, `chain.json` | AC5: a ↔ b; a beside b, b aligned to c, c onto a, and d beside a; the same with c onto the point (400, 300) |
| `offset.json` | AC6: `ball` keyed as in AC1; `tag` rect 100 × 40 `beside: ball, side: e`, its `at.pos` keyed `tag-x` 0 → 40 and `tag-y` 0 → −30 → 20 |
| `placed-film.json` | AC7: a 4 s board with `ball` keyed, `tag` beside it, `note` beside `tag` (its at.pos keyed), `head` on edge n, `rail` aligned to the ball's cy, `chip` onto the tag's ne, `grow` scaled about sw |
| `positions.json` | Proof: nine `dotK` (r 8) on a 3 × 3 grid, nine `labelK` showing "next_to(dot, DOWN, buff=0.2)" `beside: dotK, side: s, gap: 27`, nine `backK` rects 360 × 40 `onto: labelK` drawn under them. The label is the template `next_to(dot, DOWN, buff={data/buff})` over the story constant `data.buff = {value: 0.2, source: "story"}`, since honest numbers refuses a literal 0.2 in a text (`number_unsourced`) |
| `quadratic.json` | Proof: `quad` (vector@1 at 400, 280, size 480 × 160) and labels `beside: quad#disc` (n, 16), `quad#pm` (n, 40), `quad#den` (s, 12) |

Every expected value is computed in the tests from these numbers: the ball's and the tag's keys are read back from the
fixture and interpolated by the test; the tight boxes are measured on the outlines `geometry` returns, by the roots of
each segment's derivative.

## Criteria to tests

Each test's name starts with its criterion's ID.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A formula (vector@1) beside a circle with side e, gap 24 and align center: at 120 sampled times while a keyed `at.pos` channel moves the circle, the formula's west side is 24 u ± 0.5 px from the circle's east side, and the two centres' y differ by at most 0.5 px | `beside.test.ts` (2). At 120 times evenly over [0, 4 s], the formula's tight box (the join of its parts' outlines at t) sits 24 ± 0.5 east of 250 + ball-x(t) and its centre y within 0.5 of 540 + ball-y(t), and it moves at more than 100 of the steps. Fails a relation solved once at t = 0 (the formula stays while the ball moves 900 u), one that reads the target's bounds from an earlier frame (behind by up to 7.6 u a step), a box that counts the 6 u stroke (gap 21), a box from control points (8 u off), the default gap or side in place of the given one. TestBox port: at every time the formula's `box` and nine `points` are the join of its parts' tight boxes and each part's box its own tight box (within 0.01 u), and the ball's are (150 + x, 490 + y, 100, 100), stroke left out |
| AC2 | A label beside a text patched to a string 40% longer keeps its 16 u gap within 0.5 px with no patch to the label | `beside.test.ts` (2). Two revisions, the second with `head`'s text 28 characters (1.4 × 20) and `unit` byte for byte the same: the gap is 16 ± 0.5 and the centres' y equal within 0.5 in both, the text grew more than 25%, the label moved by what the text grew, and each item's ink lies inside its box. Fails a label placed once and kept (gap shrinks by the growth), a stale target box, a default gap other than 16, a box that isn't where the text draws. next_to port: a 50 × 20 rect beside the text on e, w, n and s, with align start, center and end and gaps 0, 7.5 and 31, before and after the patch: the facing sides are the gap apart and the aligned edges match within 0.5, the rect never resized |
| AC3 | A title with `edge: n` has its top side at the safe margin (24 u) ± 0.5 px at 1920 × 1080 and at 1080 × 1920 | `edge.test.ts` (3). The title's top is 24 ± 0.5 at both frame shapes, its x and size what they are without the relation, and its ink inside its box; with `safe: 40` its top is 40 at both. Fails a margin written as 24 instead of `safe`, an edge that moves x too, a frame size read from one shape, a box not where the title draws. to_edge port: a 120 × 50 rect with `edge` toward each of the eight sides, margin default and 10, at both shapes (32 documents): its side the margin in from the frame's edge, the other axis unmoved except at a corner |
| AC4 | `pivot: sw` with scale 2 keeps the lower left corner within 0.5 px | `pivot.test.ts` (3). The card's sw stays (100, 240) and its box is [100, 160, 160, 80]; the arch's drawn lower left corner (the tight box of its cubic, x ≈ 298.0, left of its first point and right of its control point 280) stays, its box twice the size. Fails a pivot at the origin, at the centre, or at the control points' corner (moves 18 u). Transforms port: every point of the scaled arch's outline is 2 (p − sw) + sw within 0.01 u, and its box is the tight box of what it draws. Keyed scale: `grow` scaled 1 → 2 keeps (500, 330) at 21 times, its box [500, 330 − 30 s, 60 s, 30 s] |
| AC5 | a beside b and b beside a is refused `relation_cycle` naming both; a planted three-item cycle names all three | `cycle.test.ts` (3). The two-item cycle is refused with an error `relation_cycle` whose `ids` hold a and b, and `geometry` answers that code; the three-item cycle through beside, align and onto is refused with one whose `ids` hold a, b and c and not d (which reads the chain but isn't in it); the same relations ending at a point pass the check. Fails a check that misses a cycle through align or onto, names only the item it found first, names every item downstream, or refuses every chain |
| AC6 | `constraint@1` seals with the four relation entries, each passing the constraint kit; a planted beside that iterates to convergence, its op count changing with the gap, and one that reads its own place from the previous frame are each refused at the seal, naming the entry; and a placed item with a keyed `at.pos` lands at its relation's place plus that offset within 0.5 px at 120 sampled times | `registry.test.ts` (3): the r2 build seals; `constraint@1` is the core's, filled by modules only, with at least four kit rules; beside, edge, onto and align are marks2d's first-party entries, each PASS on every rule; `beside_converges` and `beside_reads_previous_frame` FAIL, each named in its result with a failing rule's message, on rules the other passes; `kit_admits_all:constraint@1` is refused at the seal (`kit_admits_planted`) naming the registry and both. Fails a kit that can't fail (the seal would take the admitting kit), relations kept out of the registry, entries filed under another module or another registry, one rule refusing both plants for one reason. `offset.test.ts` (1): at 120 times the tag's box is [250 + ball-x + 16 + tag-x, 520 + ball-y + tag-y, 100, 40] within 0.5, and without its channels the relation's place alone. Fails at.pos ignored on a placed item, at.pos applied before the relation (overwritten), or at.pos in place of the relation |
| AC7 | Seeking a document of placed items to 50 random times gives the evaluated positions playing gives, bit for bit | `seek.test.ts` (1): 50 distinct seeded times in [0, 4 s); at each, the seek's canonical render and every node's result equal the warm play's; every placed item has nodes at every time, and each placed against the ball has results that change. Fails a relation that reads its target's bounds, or its own place, from the previous frame (play and seek differ), a cache keyed by frame number, a solver that writes nothing (no change across times) |
| Proof | the positions figure and the quadratic-formula labels, built as documents, with render-back boxes | `proof.test.ts` (2): nine labels each 27 u below their dot's box and centred on it, each background centred on its label and never resized, each label's ink inside its box; the quadratic formula's labels at 16, 40 and 12 u from quad#disc, quad#pm (n) and quad#den (s), centred on their parts, inside their boxes, and quad#den at [520, 384, 80, 48] |

Every test fails at the base for the missing feature: the check refuses `at.place` and `at.align` (`unknown_field`)
and a string `at.pivot` (`out_of_range`), `geometry` has no `box` or `points`, `constraint@1` holds nothing of
marks2d's, and the deep_show of placed items is refused: all 20 tests fail at the base (`BASE-FAILURE.txt`).

## Readings where the issue leaves a choice

- **"0.5 px"** is 0.5 u: every document is drawn at zoom 1, where one u is one logical pixel (Units and axes).
- **"Patched"** (AC2) is a whole new revision whose only change is the text's `params.text` (R1's whole revisions,
  as #391's `session` reads them); the label's item is byte for byte the same in both.
- **A text's box** is whatever its evaluated bounds are, as long as its ink lies inside it within 1 px and it grows
  with its run; the tests don't pin side bearings or the line box.
- **`align: start | end`** on side e or w line up the top or bottom sides, on n or s the west or east sides (the
  start of the other axis, y down).
- **`edge: n` with `at.pos`**: at.pos adds after the relation (Item and kind: relations), so the title's x comes from
  its pos and its pos y is 0.
- **`onto` with `point: ne`** (AC7) puts the item's ne box point on the target's ne.
- **`pivot: sw`** keeps the corner where it is: x ↦ sw + S·(x − sw), the corner fixed, as "scales and turns about the
  item's lower left corner" says; the base's vector pivot form (x ↦ pos + S·(x − pivot)) is not read for box points.
- **"Naming the chain"** is the chain's item IDs in the issue's `ids`, every one of them and none outside the cycle.
- **"Refused at the seal, naming the entry"** (AC6) is #200's two observations: the kit's result on each planted entry
  at the seal (FAIL, naming it), and the seal refusing the registry when its kit is replaced by one that admits every
  entry, naming the registry and each planted entry. The two planted names are this suite's.
- **"The evaluated positions"** (AC7) are the results of the placed items' nodes (#387: the SHA-256 of the bytes each
  node wrote for its item), compared with the canonical render; "bit for bit" is equal hashes.
- **The proof's buff 0.2** is ManimGX's frame unit, 8 to the frame's height: 27 u at 1080. "Render-back boxes in the
  receipt" are the boxes `geometry` reads back, held to the pixels `raster` draws; writing them into a delivery
  receipt is the delivery's, outside this suite.

## Upstream tests (the Oracle lane)

The Oracle page pins ManimGX `cfd33af5aa` for criteria 1–4 (`tests/unit/test_mobject.py`, every row "port"); 5, 6
and 7 have no upstream test. Per #136 a linked test counts only by what it asserts on our output, so each is ported:
its assertion is rewritten against what our binaries return for our documents, with our tolerances (0.01 u where it
compares a box with the same outline's tight box, the issue's 0.5 px where it compares a placement). Hypothesis's
random shapes become the fixtures' fixed ones.

- **TestBox, 359–402 (AC1).** `test_its_critical_points_are_its_boxs` (a critical point is the tight box measured on
  the curves by their derivatives' roots) and `test_a_groups_box_joins_its_members_boxes`: at each of AC1's 120 times,
  the formula's nine box points equal the join of its parts' tight boxes, each part's box its own tight box, and the
  circle's its geometric circle without its stroke. `formula.svg`'s O is drawn so the control-point box and the tight
  box differ by 8 u. Also used by AC4 to find the arch's sw.
- **test_next_to_leaves_buff_between_the_two, 414–439 (AC1, AC2).** The facing sides are buff apart and the aligned
  edges match, for each direction and each aligned edge `PERPENDICULAR_EDGES` allows: `beside.test.ts`'s next_to port,
  on e, w, n and s with start, center and end, before and after the text's patch. AC1's own test is the same
  assertion for side e, center, gap 24 at 120 times.
- **test_to_edge_puts_the_box_buff_in_from_the_frames_edge, 459–468 (AC3).** Each of eight directions puts the box's
  side buff in from the frame's edge: `edge.test.ts`'s to_edge port, at both of our frame shapes (the page: "The two
  frame shapes are our fixture's").
- **Transforms, 266–356 (AC4).** Its `scale` rule about an edge and its invariant `its_points_are_the_arithmetic`:
  every point of the arch scaled 2 about sw is 2 (p − sw) + sw; `its_box_is_what_it_draws`: its box is the tight box
  of its outline. The other rules (shift, rotate, flip, stretch, matrices) aren't asked for by AC4.

`BASE-FAILURE.txt` is the run at the base.

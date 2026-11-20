# Acceptance tests for #2500: text anchors for shots and a puppet's reach

Written first, from issue #2500 (its scope and its two acceptance criteria), the text of its dependency #1966 (merged
at the base: code lines and the read-only anchors `#line:n` and `#tok:k`), the design sections they link and those they
lean on, and the base commit, by a job that never saw an implementation. No other worktree, branch, pull request, stash
or `tests/acceptance/2500*` folder was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

The base is this worktree's HEAD, `2b36234a7` ("Merge pull request #2862 …"): `a4d0290b5` ("Merge pull request #2846 …",
the base the job was given) with the merge of #2862 (#2776: the 3D entries' Paths subsections and their registry
metadata), which touches none of the design sections or code this suite reads.

## What was read

- The issue, live (`gh issue view 2500 --repo windoliver/deepbuild`), and #1966's issue text.
- `docs/technical-design.md`: Films and figures on the canvas (timeline and camera shots; jointed puppets as puppet@1
  rigs; code shown as code), Dogfooding, Tests written first.
- `docs/canvas-primitives.md`: Text `text@1` and Text `text@1`: code (the read-only anchors); ID and sub-address; Path
  `path@1` (`attach` naming `ID#line:n`); Camera `camera@1` and Camera `camera@1`: framing; Shot; Constraint and
  Constraint: bones (`reach2`); Pack: puppet@1 characters as data; Rig `puppet.rig@1` (a chain expands into a reach2,
  a pose's `targets: {chain → [u, u] | anchor}`); the Document envelope's `safe`.
- At the base, only to learn how surfaces are driven and what their answers look like: `tests/acceptance/1966/`
  (README, helpers, `highlight.test.ts`, `BASE-FAILURE.txt`), `1965/helpers.ts`, `467/helpers.ts`, `493/` (README,
  helpers, `framing-bound.test.ts`), `493-redraft-ac12/` and `493-redraft-ac7/defaults.test.ts`, `489/` (README,
  helpers, `reach2-stretch.test.ts`); `crates/deep-motion/src/main.rs` (`eval`: `shots`, `project`, items),
  `crates/deep-canvas-motion/src/shots.rs` (the keep fit and the extents it knows), `doc.rs` and `program.rs` (reach2's
  target), `crates/deep-marks-render/src/{lib,raster,place}.rs` (`geometry`), `crates/deep-canvas-marks/src/{lines,code}.rs`
  (the anchors' boxes and `#tok:k`'s index); `scripts/proof-change.mjs` (criterion IDs). Probes of the base's
  `deep-motion` and `deep-canvas-render` with this suite's documents.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/2500 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/2500      # type-check (exits 0)
```

Each file builds `deep-canvas-render` (#467's `useBin`) and `deep-motion` (#493's `useMotion`) once, `cargo build
--locked --bin …`, honoring `CARGO_TARGET_DIR`; a test whose build failed fails with cargo's error. The files build
cargo binaries, so they run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/2500/'` in its `alone` list
(this job writes only this folder; the implementer makes that edit). Every test passes `TIMEOUT` (30 min); nothing is
timed. A run with `--root` leaves Vitest's cache in `tests/acceptance/2500/node_modules/.vite`; delete it. Node
built-ins and vitest only; temporary folders are deleted. The folder imports `../467/helpers.ts`, `../1965/helpers.ts`,
`../1966/helpers.ts` and `../493/helpers.ts` by path.

## The surfaces under test

No new binary, subcommand, input or output. Two binaries at the base:

- **`deep-canvas-render`** (#373, #1965, #1966), with #1965's look `LOOK_A`: **`raster {out, doc, look, t: 0}`** →
  `texts.cfg = {shown, glyphs: [{x, y, grapheme, advance, …}]}` (pen position and baseline from the item's origin), which
  says where every line and token of the code is; **`geometry {doc, look, item, t}`** → `box: [x, y, w, h]` in u at `t`,
  for `cfg#line:n`, `cfg#tok:k` (the read-only anchors as #1966 answers them) and `cfg` (the whole item).
- **`deep-motion eval`** (#391, #489, #493), one JSON line in and one out: `{doc, times, project?}` →
  `{ok, frames: [{t, items: {<id>: {at: {pos}}}, projected: {<id>: {center: [x, y], box: [x0, y0, x1, y1]}}}], shots}`.
  `items.<id>.at.pos` is the item's world position after its channels and constraints; `projected.<id>` is the item's
  bounds through the pose the document's camera shows at t, in px of the document's size (#493). A refusal is `{ok:
  false, code, path, …}`.

The documents, built in `helpers.ts`:

- **The code** `cfg`: `text@1` with `font: mono`, `size: 24`, ink, `raw` and `code: {language: python, tokens, numbers:
  false}`, at `at.pos [200, 260]`. Seven lines, no digits and no number words; eleven keyword and call tokens in order,
  `tokens[2]` being `with` on line 2:

  ```
  def load(path, mode):
      with open(path, mode) as handle:
          text = handle.read()
      cfg = parse(text)
      for key in sorted(cfg):
          print(key, cfg[key])
      return cfg
  ```

- **The page** (`deep-canvas-render`, #467's envelope as #1966's suite writes it, 1280 × 720): the code still, or
  scrolling: a channel keys `items/cfg/at/pos/1` linearly from 260 at 0 s to 140 at 2 s (`transport.span: 3s`).
- **A shot film** (`deep-motion`, #493's envelope, the same size, 60 fps, `safe: 0`): the still code, a 2D camera
  `cam` over the page, one shot `{start: 0s, end: 2s, camera: cam, move: hold, frame: {keep: [<one ID>], pad: 0, fill:
  0.5}}`, and four unkept `rect@1` stand-ins whose `params.box` are the boxes `geometry` gives at 0 s for `cfg#line:1`
  (`l1`), `cfg#line:4` (`l4`), `cfg#line:5` (`l5`) and `cfg` (`whole`). The line test's shot keeps `cfg#line:4`, the
  twin's keeps `cfg`; planted shots keep a stand-in.
- **The arm film** (`deep-motion`, the same envelope): the scrolling code and a puppet's arm, three `rect@1` parts in a
  chain (`upper_arm` at [560, 330], `forearm` 200 u along it, `hand` 200 u along that), with
  `constraints: {reach: {owner: upper_arm, kind: reach2, chain: [upper_arm, forearm, hand], target: "cfg#tok:2",
  bend: 1}}` (Choices). The hand is the chain's end, `items.hand.at.pos`.

## Criteria to tests

Each test's name starts with the criterion's ID as `scripts/proof-change.mjs` computes it.

| ID | Criterion (the issue's text) | Tests and assertions |
|---|---|---|
| AC1 `#2500.bceb1cbb` | A shot keeping `cfg#line:4` of a code item frames line 4's box at its fill within the framing's tolerance, and a twin keeping `cfg` frames the whole item | `framing.test.ts` (2). **(line)** The box `geometry` gives for `cfg#line:4` is line 4's: it holds line 4's baseline and spans its glyphs (from `raster`), and reaches neither line 3's nor line 5's baseline. Then `deep-motion eval` of the shot keeping `cfg#line:4`, at 0, 0.5, 1 and 1.5 s and the shot's last 60 fps frame: the film is accepted, and on every frame `projected.l4` (line 4's box through the pose shown) spans the shot's fill, 0.5 of the frame's shorter side (360 px), within 1%, and its centre lands on the place, the frame's centre (640, 360), within 0.5 px. **(twin)** The box `geometry` gives for `cfg` holds every line's baseline and glyphs; the shot keeping `cfg`, at the same frames: `projected.whole` spans 360 px within 1% and its centre lands within 0.5 px of (640, 360) |
| AC2 `#2500.eb02ef3c` | A puppet reaching for `cfg#tok:2` ends its hand on that token's box within 0.5 u while the code moves | `reach.test.ts` (1). At 0, 0.37, 0.5, 1, 1.13, 1.5, 1.71 and 2 s of the scroll: the box `geometry` gives for `cfg#tok:2` is token 2's where the scroll has put it (it holds `with`'s baseline and glyphs, moved by the channel's linear value; reaches neither line 1's nor line 3's baseline; holds no glyph of tokens 1 and 3). Then `deep-motion eval` of the arm film at the same times: the film is accepted, its code is where the scroll puts it (within 1e-6 u), and the hand lies within 0.5 u of that time's `cfg#tok:2` box (its distance to the box, 0 inside) |

## Wrong programs

Each test first runs its judge on planted wrong programs and requires it to fail, naming what it catches; they are
built from the binaries' own answers at the base (#493's framer on `rect@1` stand-ins, `geometry`'s boxes), so they
hold before and after the work.

- **(line)** a shot that frames the whole item, the anchor dropped (keeping `whole`: line 4's box spans 210 px, not
  360); one that frames line 5, `#line:4` counted from 0 (keeping `l5`: line 4's box lands about 49 px off its place).
  Also failed, unplanted: line 3, a pad kept, the camera's default fill in place of the shot's, a line box that misses a
  glyph or takes in a neighbour's.
- **(twin)** a twin that frames line 4, the anchor's box kept for the bare ID (keeping `l4`: the whole item's box spans
  617 px); one that frames the code's first line only (keeping `l1`). Also failed, unplanted: the item framed as a point
  at its origin (the base's program: no finite box).
- **(reach)** hands at the centre of a wrong box `geometry` gives at each time: the whole item's (the anchor dropped);
  `cfg#tok:1`'s (`#tok:2` counted from 1); `cfg#tok:3`'s (off by one the other way); and `cfg#tok:2`'s at 0 s at every
  time (a hand left at its first-frame target while the code moves). Also failed, unplanted: a reach refused or
  unresolved, a target aimed at the code's origin (what reach2 aims at for the item `cfg` at the base), a hand that
  stops short of the token.

## Choices

Names the issue and the design leave open, chosen here as the smallest addition consistent with the base and the
design; the implementer builds exactly these, or a dispute goes to a blind redraft.

1. **A puppet's reach is the reach2 constraint a rig's chain expands into**, written directly: `constraints: {<id>:
   {owner: <upper part>, kind: "reach2", chain: [<upper>, <lower>, <end>], target: "cfg#tok:2", bend: 1}}`, with
   reach2's own `target` naming the anchor. The design says a `puppet.rig@1` "expanded at check into … a reach2
   constraint per chain" and lets a pose's chain target be an anchor; the puppet@1 pack (#153) isn't built at the base,
   so no rig kind exists, while motion's `constraint@1` entry `reach2` does (#489). The hand is the chain's end part.
   When a rig lands, its chain's reach is this constraint.
2. **The surfaces** are `deep-motion eval` (shots, projections, world positions, refusals) and `deep-canvas-render`
   (`raster`, `geometry`) as the base has them. Nothing is added to either: the work is that a shot's `frame.keep` and a
   reach2's `target` accept `<id>#line:n` and `<id>#tok:k` (and that a kept text item frames by its box), in
   `deep-motion` as in every build that compiles the motion module's plan.

## Readings where the issue and design leave a choice

- **`#line:n` and `#tok:k`** count as #1966 left them at the base: `#line:n` from `first_line` (1), `#tok:k` the token
  `tokens` lists at index k, from 0. So `cfg#tok:2` is the third token listed, `with`; `geometry` answers it so, and
  #1965's suite (`cfg#tok:1999` the last of 2,000 tokens) and #1968's (tokens 0 to 5) count the same. A reading from 1
  reaches `load`, token 1, and fails.
- **"Line 4's box", "that token's box", "the whole item"** are the boxes `geometry` gives for `cfg#line:4`, `cfg#tok:2`
  and `cfg` at that time: the anchors' boxes from the one shaped run, and the text's own box at its position, which
  relations and attachments read. Each is first checked against the glyphs `raster` sets, so a wrong anchor can't pass
  by agreeing with itself. `numbers: false` keeps the gutter out of every box: no criterion says whether a line's or the
  item's box takes in its number.
- **"Frames … at its fill"**: the shot's `frame.fill` (0.5, set apart from the camera's default 0.6, so "its" is the
  shot's), with `pad: 0`, since a pad would widen the kept box and the criterion names the box itself; the box's larger
  projected side (its width, for a line) spans the fill of the frame's shorter side, as the base's 2D framing spans its
  kept items, and its centre lands on the place, the default `[0.5, 0.5]`. The film has `safe: 0`, so the place (a
  fraction of the safe frame) and the fill read the same on the safe frame and on the whole frame.
- **"Within the framing's tolerance"**: the framing's own two, 1% on the fill (Camera `camera@1`: framing bounds the
  kept items "within 1% of the largest extent") and 0.5 px on the place (#493's AC12: "a shot's framing puts the kept
  items' center at its place within 0.5 px"). For line 4's box a span read along its half-diagonal differs from its
  width by under 0.6%, inside the 1%.
- **Where a box lands** is read through the binary's own projection (`project`) of an unkept `rect@1` at that box, so
  the test needs no model of the camera, and the code in the shot films stands still: the criterion frames a box, not a
  move.
- **"A twin keeping `cfg`"** is the same film with `keep: ["cfg"]`.
- **"While the code moves"**: the code item's `at.pos` y keyed by a channel, as #1966's suite scrolls code; read at eight
  times over the 2 s move, three off the key grid. The span is 3 s, so no time sits on a loop's wrap.
- **"Ends its hand on that token's box within 0.5 u"**: at each time the hand lies within 0.5 u of the box (its distance
  to the box, 0 inside). "The point the reach names" isn't named in the film, so the reach takes its default point;
  every point of the box meets the criterion. The arm reaches the box's every point at every time (the box stays 245 to
  342 u from the shoulder, the arm 400 u long), so a correct reach is never cut short.
- **Which film each read uses**: the hands and frames come from `deep-motion`; the boxes they are judged against, and
  the plants' boxes, from the page with the same code item and channel through `deep-canvas-render`, which the base
  answers (the code doesn't depend on a shot or an arm that reads it). The arm film's own code position is checked
  against the scroll.

## What the base already does and these tests don't credit

`geometry` answers `cfg#line:n`, `cfg#tok:k` and `cfg` with the boxes above (#1966); `deep-motion` frames `rect@1`
items by their boxes and projects them (#493); reach2 solves a chain toward an item (#489). The tests lean on these only
to read and to build the plants; every box check passed and every plant was rejected at the base.

## What is missing at the base (why each test fails)

`BASE-FAILURE.txt` is the run.

- AC1 (line): `deep-motion` refuses the shot, `ref_unresolved` at `shots/s/frame/keep` naming `cfg#line:4`: a keep
  names items only.
- AC1 (twin): motion's framer knows no extent for a text item, so it frames `cfg` as a point at its origin (view width
  0), and the whole item's box projects to no finite box on any frame.
- AC2: `deep-motion` refuses the arm, `ref_unresolved` at `constraints/reach/target`: reach2's target names items only.

## Not tested, because no criterion says so

A shot keeping `<id>#tok:k` and a reach aiming at `<id>#line:n` (the scope's other halves); a kept anchor's union over a
shot while the code moves; moves other than hold, places other than the centre, pads and safe margins; a point the reach
names; a `puppet.rig@1` item and its poses' `targets` (puppet@1, #153, isn't built); 3D; lists' `#line:n`; the app's own
camera through `deep-show` (it reads the same motion plan); and every timing (the issue states none).

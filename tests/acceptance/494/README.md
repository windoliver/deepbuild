# Acceptance tests for #494: motion paths: keys that travel on arcs and spirals, and paths that morph into other items

Written first, from issue #494 (its Scope, its 5 acceptance criteria and its Proof line: "Morph and travel fixtures at
sampled times, with the strict morph refused"), the design sections it names and those they lean on, and base commit
`dba9cd04` (main plus #493's shots work, which #494 depends on), by a job that never saw an implementation; none
existed, and no other worktree, branch, PR or stash was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 494 --repo windoliver/deepbuild`), no comments. 5 criteria: 4 functional and the
  "Shown to you" taste call, AC5.
- `docs/technical-design.md`: Films and figures on the canvas (Motion grammars, Formulas and text, Timeline and camera
  shots); Shot and transition; the module table's motion row (key `travel`, path keys `{of}`); Dogfooding.
- `docs/canvas-primitives.md`: Channel and key (the `morph`, `travel` and `{of}` fields and their semantics: the arc
  "turning counterclockwise on screen for a positive angle", the spiral `start + u × R((u − 1) × angle)(end − start)`,
  "an arc or spiral under 0.57° (0.01 rad) is straight", the match of unequal path keys); Transition (`match_morph
  {pairs, unpaired}`, "a match_morph may also name two items in one shot", pairing by id, by key, then by shape hash);
  Path `path@1` (`verbs`, `pts`); Vector and formula `vector@1` (parts by id, the viewBox placed into `size` from
  `at.pos`); Graph and layout memory `graph@1`; Mark set; ID and sub-address; Path and handle.
- At the base: `crates/deep-motion/src/main.rs` (`eval`, its frames' `items` and `channels.<id>.value`);
  `crates/deep-canvas-motion/src/doc.rs` (`channel_of`: the channel types, no `path`; key fields read: `t`, `value`,
  `interp`, `velocity`, nothing else), `curve.rs`, `shots.rs` (transitions resolve `from`/`to` among shots only;
  `match_morph` and `text_diff` parse to `Kind::Other`), `crates/deep-canvas-vector` (`lower::placement`, parts),
  `crates/deep-canvas-graph` (the layered layout, its params), `crates/deep-show` (`film.rs`'s film block, `hub.rs`'s
  vector import from the evidence store, `deep-canvas/src/document/check.rs`'s `requires.modules` rule); the merged blind
  suites `tests/acceptance/493/`, `492/`, `489/`, whose layout and conventions this one follows; `scripts/proof-change.mjs`
  (criterion IDs).

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/494 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/494/tsconfig.json   # type-check (exits 0)
```

`cargo` must be on PATH. `--root` keeps the repo's `vitest.config.ts` out; it leaves Vitest's cache in
`tests/acceptance/494/node_modules/.vite`, which is not part of the suite. Each file builds what it uses once, in
`beforeAll`, and copies the binary out: `cargo build --locked --bin deep-motion` (`path-morph`, `travel`) or `cargo build
--locked --bin deep-show --no-default-features --features full` (`match-morph`, `of-keys`). Every test of a file fails
when its build fails. The files build cargo binaries, so they run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/494/'` in its `alone` list (this job writes only this folder; the implementer makes that edit). Every
`it` passes `TIMEOUT` (30 min). Nothing is timed. Node built-ins and vitest only.

## The surface under test

The issue names fields and observations but no API, so these tests extend the two surfaces the base already has:
`deep-motion eval` for channels and keys, and `deep-show run`'s `eval` with #493's `film: true` for what needs the
evidence store (formula imports) or the canvas modules (graphs). No new binary or subcommand. **Every name below that
neither the issue nor the design gives is this job's choice** (listed again under Choices); the implementer builds
exactly these, or a dispute goes to a blind redraft. The tests judge values, never how they were reached.

### Coordinates

The canvas's 2D page is in u with the origin top left and **y down** (as #493's 2D camera). "Counterclockwise as seen on
screen" is therefore R(θ)(x, y) = (x cos θ + y sin θ, −x sin θ + y cos θ). So the issue's arc from (−2, 0) to (2, 0)
at +180° passes below the chord on screen, through (0, 2) (9 o'clock → 6 → 3 is counterclockwise), and the spiral's
0.5 × R(−45°)(100, 0) is (35.3553…, 35.3553…) u. A vec3 position channel turns in the xy plane, about `axis`'s default
(0, 0, 1).

### Path value

A path as a channel value, a key value or a readout: `{"verbs": ["M", "L", …, "Z"], "pts": [x0, y0, x1, y1, …]}`, path@1's
own columns. The tests write verbs as letters and read letters or path@1's u8 codes (0..4 = M L Q C Z). They read
on-curve points only (each verb's last point); every fixture is a polygon, so a matched path is too.

### Channel and key (deep-motion and deep-show)

- **Path channel:** `channels.<ID> = {target: "items/<item>/path", type: "path", morph?: "match" | "strict", keys}`. The
  target `items/<item>/path` is the item's evaluated path (for a path@1 its `verbs` and `pts`; for a vector@1 all its
  parts' outlines as sub-paths, in part order), the same notion `{of}` reads.
- **Key value** on a path channel: a Path value, or `{"of": "<item ID>[#<part>]"}`.
- **Travel**, on a key (it owns its segment, as `interp` does): `travel: "straight" | {"arc": {"angle": deg, "axis"?,
  "centers"?}} | {"spiral": {"angle": deg}}`, the design's `arc {angle}` written as the base writes `{bezier: {…}}` and
  #493's transition kinds' fields, under the kind's name. The tests use vec3 position channels
  (`items/<id>/at/pos`, `[x, y, 0]`), keys at 0 s and 1 s with `interp: "linear"`, so u is the time share.

### `deep-motion eval`

Input and answer as at the base (`{"doc", "times"}` → `{"ok", "frames": [{"t", "items", "channels", …}]}`). Read:
`frames[].items.<id>.at.pos` (travel) and `frames[].channels.<ID>.value` (a path channel's Path value at t).
Refusals as at the base, `{"ok": false, "code", "path", …}`, whose whole JSON is searched for the channel ID; no code is
pinned.

### `deep-show run`

#493's scenario, `deep show` of a whole document (no `layers`, no item `layer`) and `eval {doc, t, film: true}`. The film
block gains two fields, present on every `film: true` reply:

- `paths: {<item ID>: Path value}`: the evaluated path at t of each item a path channel writes.
- `morphs: {<transition ID>: {"progress": 0..1, "pieces": [{"from": "<item>#<part>" | null, "to": "<item>#<part>" |
  null, "center": [x, y], "opacity": 0..1}]}}`: for every `match_morph` transition, at every t (progress 0 before its
  window, 1 after), each piece it draws: `from` the outgoing part it comes from, `to` the incoming part it goes to (null
  for none), `center` the centre of the piece's drawn bounds in document u, `opacity` its drawn opacity. A paired part is
  one piece with both names; an unpaired part that fades is a piece with one name null (`from` set going out, `to` set
  coming in), also under `cross_fade`; a split gives one piece per copy, each with the same `from` and its own `to`. A
  graph's node is the part `<item>#<node key>`, a vector's part `<item>#<id>`.

### Documents

#391's envelope (`{format: 1, id, profile: "film", title, description, size: [800, 450], camera: "cam", layers,
transport: {span: "2s"}, items, …}`), a still 2D camera@1 `cam` over the page, and `requires: {modules: {vector: "^1",
graph: "^1"}}` for the kinds a film uses (Document envelope; `deep show` refuses an undeclared module's kind).

| Field | As the tests write it |
|---|---|
| Formula | `vector@1` with `params: {src: <sha256 of an SVG in the evidence store>, size: [800, 450], colors: {"#000000": "ink"}, alt}`, `at.pos [0, 0, 0]`; the SVG's viewBox is `0 0 800 450` with one filled `<path id=…>` per part, so SVG units are document u |
| Graph | `graph@1` with `params: {graph: {nodes: [{id, w: 64, h: 32}], edges: [{id, a, b}]}, layout: {algo: "layered", seed: 494, spacing: {rank: 48}}}` |
| Match morph | `transitions: {<ID>: {from: <item>, to: <item>, kind: "match_morph", at: "0.5s", span: "1s", progress: "linear", match_morph: {pairs?, unpaired?}}}`: two items in one film with no shots; `at` is the time the window aligns on (as the cut does between shots, `align` left at center), so the window is [0 s, 1 s] |
| Pairs | `pairs: {"#x": "#y"}`, as the issue writes it: part x of `from` with part y of `to` |
| Unpaired | `unpaired: "fade" | "morph" | "cross_fade" | "split"` (the tests use the default, `cross_fade` and `split`) |

## Criteria to tests

Each test's name starts with the criterion's ID (`AC<n> #494.<sha8>`, as `scripts/proof-change.mjs` computes it).

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#494.e411da84` | `path-morph.test.ts` (3) | a 64-gon circle (r 100) keyed to a 10-point star: at every 60 fps frame of [0, 1] s one closed sub-path of 64 points; at 0 s every point on the circle within 0.01 u, all round it; at 1 s every point on the star within 0.01 u, each edge holding ≥ 2; at 0.5 s each point the mean of its readings at the keys within 1e-9 and moved (fails a hold, a jump, a cross-fade); each frame sought alone equals the play bit for bit; `morph: strict` refused naming `circle-to-star`, while match is accepted and strict 64-gon to 64-gon is accepted (fails a strict that refuses everything) |
| AC2 `#494.67b2ec28` | `match-morph.test.ts` (2) | formulas "x + y" → "y + x": the pieces `fa#x → fb#x`, `plus`, `y` at old + p (new − old) within 0.5 u at 0, 0.5, 1 s (fails pairing by reading order or shape); `fa#old` and `fb#new` fade in place, opacity 1 → 0 and 0 → 1; graph `a→b→c` (listed a, b, c) → `c→b→a` (listed c, b, a): each node's piece names its key on both sides, a ends where c began, c where a began, b stays (fails pairing by row or shape) |
| AC3 `#494.32c3ee38` | `travel.test.ts` (4) | arc 180° at u = 0.5 is (0, 2), −180° is (0, −2), ends exact, within 1e-9; two unit squares swapped at ±180° never overlap at 200 times, while swapped straight they do; spiral 90° at u = 0.5 is 0.5 × R(−45°)(100, 0) within 1e-9; arc 0.5° equals straight bit for bit at 200 times |
| AC4 `#494.a4c0e37e` | `of-keys.test.ts` (4) | fa's path keyed from A's outline to `{of: "fb"}`: at 1 s every point on B's outline within 0.01 u, each of B's three parts carrying ≥ 3; with `pairs: {"#x": "#y"}` the piece from `fa#x` goes to `fb#y` and ends at y's place within 0.5 u, and without pairs at B's x (control); `cross_fade`: at every 60 fps frame of [0, 1] s the out piece's and in piece's opacities sum to 1 ± 0.01, the out piece going 1 → 0; `split`: at 1 s three pieces from `fa#sq` to `fb#s1..s3`, each on its square within 0.5 u, faded (0 < opacity < 1) at 0.5 s |
| AC5 `#494.862daf9a` | `taste.test.ts` (1) | reads the record only; no pictures or no call is INCONCLUSIVE, never PASS (The taste call) |

## Choices where the issue is open

1. **Surfaces.** Channels and travel through `deep-motion eval`; formulas and graphs through `deep-show run`, which holds
   the evidence store the SVGs come from. The new outputs are `film.paths` and `film.morphs`.
2. **Path channel target** `items/<item>/path`, and its value `{verbs, pts}` (above).
3. **"At 64 points".** The circle key is the regular 64-gon (each vertex on the circle), the larger count, so the match
   resamples the star to 64 by arc length; the channel reads 64 points at every time, the keys' times included (the keys
   hold their matched values, as the base already replaces quaternion keys by their aligned ones at compile).
4. **"Equals the star within 0.01 u"** is every point on the star's outline within 0.01 u and every edge holding ≥ 2
   points; a resample by arc length may cut a tip, the issue's measure is "at 64 points".
5. **Travel syntax** `{arc: {angle}}`, `{spiral: {angle}}` on the key that owns the segment.
6. **"Two items swapped with ±180°"** is the swap done twice, both items at +180°, then both at −180° (with one at each
   sign they would meet at (0, ±2)); "never overlap" is two unit squares centred on the positions.
7. **A match morph between two items** sits at `at` (the window's centre), `span: 1s`, `progress: "linear"`, so "along
   the progress" at 0, 0.5 and 1 s is p = 0, 0.5, 1. `morphs` reports at every t, so the morph's end (1 s) is readable.
8. **"Two states of one graph"** are two graph@1 items with the same node keys, `g1` and `g2`, at one place.
9. **The `{of}` morph's first key** is A's outline written out, since an item keyed `{of}` itself would read its own
   output; A and B have three parts each, so no sub-path shrinks to a centroid at the last key.
10. **Split squares.** B's three squares (20 u) differ in size from A's square (60 u): the shape hash is taken to be
    translation-invariant only, so no shape pairing takes the square before `split` does.
11. **"Faded copies"** are copies with 0 < opacity < 1 halfway through the morph.

## Criteria out of reach

- **AC5's "taken by the check run from the canvas's own frames" and "attached to the PR and shown to you".**
  `taste.test.ts` reads what is recorded and can't see how a picture was made or where it was shown. It holds
  INCONCLUSIVE until the record exists.

## The taste call

The check run writes four files to `docs/evidence/494/`: `arc.png` (a position key travelling on a 180° arc),
`circle-star.png` (a circle morphing into a five-point star), `formula-morph.png` (formula A morphing into B), each from
the canvas's own frames, and `arc-and-morphs.apng` (a recording of the arc and the two morphs). The owner's one call goes
in `tests/acceptance/494/TASTE.json`, as in #493:

```json
{ "issue": 494, "criterion": "#494.862daf9a", "verdict": "looks_right", "who": "…", "when": "2026-11-09T09:00:00Z",
  "screenshots": { "arc.png": "<sha256>", "…": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all four with their SHA-256. No test judges a picture.

## What the base already does and these tests don't credit

`deep-motion eval` keys vec3 position channels linearly and ignores any key field but `t`, `value`, `interp` and
`velocity`, so `travel` goes straight; it refuses `type: "path"` (`bad_type`). `deep-show`'s transitions resolve `from`
and `to` among shots only (shots.rs skips one that names items), and its film block carries `cameras`, `dissolve`,
`parallax` and `glyphs`, no `paths` or `morphs`. So every test fails at the base but one: the 0.5° arc equals straight,
which the base gets by ignoring `travel`; it sits beside the 180° and spiral tests, which fail a program that ignores it
(`BASE-FAILURE.txt`).

## Scope not under a criterion

The Scope also names `text_diff`'s tokens (words or a code item's own tokens), mark-set rows paired by key, `centers`
(per point or one centre), `unpaired: morph`, sub-paths paired by area and centroid with start points turned for the
least distance, and a sub-path with no partner grown from its centroid. No criterion states an observation for them, so
these tests don't check them; they are follow-ups for the implementer's own tests.

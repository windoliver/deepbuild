# Acceptance tests for #450: trails on any item, ribbon trails, trails since an occurrence and whole-window trails

Written first, from issue #450 (its summary, Scope, Fields, five acceptance criteria and Proof line), its oracle page,
the design sections it links and those they lean on, and base commit `53c0e72a3` ("Merge pull request #2356 …"), by a
job that never saw an implementation; none existed, and no other branch, worktree or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #450, live with `gh issue view 450 --repo windoliver/deepbuild`, and its oracle page
  (`doneright/oracles/issues/450.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test checks any of these
  criteria, so nothing is ported (the Oracle lane has nothing to run).
- `docs/technical-design.md`: Particles, closed form; Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: Marks in 3D, Marks in 3D: lines, Marks in 3D: trail; Particles `particles@1` and its
  sections, chiefly trails and mesh draws, and space and paths (an earlier-time read of an item's world pose goes
  through the chain a trail reads); Marker (markers of each kind compile into the occurrence list `markers.<kind>`);
  Occurrence list; the closed function list's occurrence reads (`since`, `last`, `next`, `count`, `rank`, payload
  fields as `last(list).field`); Units and axes (metres, +Y up, degrees, R = Rz·Ry·Rx, flicks).
- At the base, only to find the surfaces that exist: `crates/deep-gpu-layer` (`main.rs`: `enum Planted`, `fn call`;
  `particles.rs`: the `particles` call, `view3d`'s `particles` hash; `view3d.rs`: the request fields and each frame's
  reply; `fed.rs`: `evaluate`); `crates/deep-canvas-scene3d/src/spec.rs` and `scene.rs` (`mark.line@1`'s params and its
  segments, `world` composing parents, `origin_at` and `wake_path`, #166's earlier-time reads); `crates/deep-canvas-motion`
  (`occurrence.rs`, `program.rs`'s `markers.<kind>` lists with their payloads, `curve.rs`'s f64 linear keys, and
  `tests/times_491.rs` for how a driver binds `{"list": "markers.cue"}`); `crates/deep-canvas/src/expr.rs` (`min`,
  `sin`, `cos`, `rad`); `scripts/proof-change.mjs` (criterion IDs); `scripts/lanes.mjs` (`alone`); and the suites
  `tests/acceptance/449/` (whose helpers these tests import), `420/` (seek against play), `2016/` (a `view3d` read-back
  field), `485/` and `252/` (a taste call, an animated PNG of the canvas's own frames).

## What the base already does, which these tests don't credit

`particles@1` is #449's: `deep-gpu`'s `particles` call checks a document and gives each particle's CPU f64 closed form,
and `view3d`'s `particles` field gives each frame an evaluated-data hash of an item's rows; `draw` reads `dot`, `spark`,
`puff` and `streak`, and an object such as `{"ribbon": {…}}` draws as a dot (the hash covers each row's head alone).
`mark.line@1` draws its `points`, which may be anchors or a logic array's rows; it has no `trail`, and `view3d` draws a
document whose line has a `trail` and no `points` without refusing it. Drivers read `since`, `last` and payload fields over `markers.cue`, and a water
wake reads an item's world origin at earlier times through its channels and parents. There is no trail, ribbon, bake of
a trail, `trail` call or `trails` field: the `trail` call answers `{"code": "bad_input", "reason": "unknown call"}`, and
`view3d`'s frames carry no `trails`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/450 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/450/tsconfig.json
```

Each file builds `deep-gpu` once, in `beforeAll` (#449's `useBins`: `cargo build --locked --bin deep-gpu`, honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` and `NO_COLOR=1` unless set, Homebrew's rustup
first on `PATH` when present), and copies it into a temporary folder. No test feature is needed: the planted program is
`deep-gpu run --planted <name>`. Every test passes its own timeout (60 minutes); each call writes into the test's own
temporary folder, deleted after it; processes are started by `spawnSync` and stopped only by their own timeout.

**`scripts/lanes.mjs` needs this suite in its `alone` list**, beside the other `deep-gpu` suites, because its files build
cargo binaries and draw on the Metal device. This README is the instruction; the implementer adds the line:

```js
alone.push('tests/acceptance/450/');
```

Gates: no cargo is `BLOCKED:`, a failed test, never a pass. Every `view3d` reading draws on Metal: off macOS, or wherever
a reply says `unsupported_platform`, those tests fail with a message starting `INCONCLUSIVE:`, never passing. The `trail`
call and the `particles` call run on `--backend noop`. `taste.test.ts` is INCONCLUSIVE until the owner's call is recorded
(below). No test reads a timing.

## The surface under test

The issue names fields and behaviours but no call. **Every call, request field, reply field, document field shape and
planted name below that the issue or the design doesn't give is this job's invention**, the smallest the criteria need,
on the binary that already draws particles and 3D lines. The implementer builds exactly these, or a dispute goes to a
blind redraft. #449's README defines the `particles` call, `view3d`'s `particles` and `particle_cull` fields and
`runGpu`'s scenario (`{"out", "calls"}` in, `{"ok": true, "replies"}` out); they hold unchanged except where said below.
All times in requests and replies here are whole flicks (705,600,000 a second); places are world metres as f64.

### `deep-gpu run`: the `trail` call

```json
{"call": "trail", "doc": "<path>"}
```

- `doc`: a document file as `view3d` reads it. First, **the document check**: the canvas core's check with the trail
  rules this issue adds (the same rules a revision meets anywhere the check runs); its error issues refuse the
  document. Then each trail whose window is `whole` is baked as the check bakes it.
- The call needs no device and answers on `--backend noop`.

Reply, when the call itself can't run (an unreadable path): `{"code": "...", "reason": "..."}`. Otherwise:

```json
{"outcome": "refused", "issues": [Issue, …]}
{"outcome": "checked", "issues": [Issue, …], "trails": {"<line ID>": {"window": "span" | "since" | "whole", "samples": [{"t": flicks, "at": [x, y, z]}, …] | null}, …}}
```

- **Issue** is the canvas core's issue JSON, as #449's README gives it.
- `trails`: every `mark.line@1` of the document with a `trail`, by ID. `window`: its window's kind. `samples`: for a
  `whole` window, the bake: the source's world position at from + k ÷ rate for k = 0, 1, … while that time is at or
  before the transport's end, in order, `t` each sample's time (from's flick plus k × 705,600,000 ÷ rate, whole flicks);
  `null` for the other windows.

### `deep-gpu run`: `view3d`, the `trails` request field

```json
{"call": "view3d", …, "trails": ["<line ID>", …]}
```

Each frame gains, for the lines named:

```json
"trails": {"<line ID>": {"hash": "<sha256>", "source": [x, y, z], "traces": [{"start": flicks, "end": flicks, "points": [[x, y, z], …]}, …]}}
```

- `points`: the polyline this frame draws for that trace, world m, f64, oldest first, exactly the points it draws:
  - window `span`: `segments` + 1 points, point i the source at t − (segments − i) × span ÷ segments (whole flicks), so
    the last is the source at t; `start` t − span, `end` t;
  - window `since`: one trace for each of the last `keep` matching starts at or before t, oldest first; `start` the
    match's flick; `end` the trace's end once t has passed it (its `until` match after the start, or else the next
    start), and t before then; `segments` + 1 points at start + ⌊i × (end − start) ÷ segments⌋, i = 0 to segments;
  - window `whole`: the bake's samples whose time is before t (and not before t − span), in order, then the source at
    t; `start` the first drawn sample's time, `end` t.
- `source`: the trail's source's world position at the frame's time, the same evaluation its points use.
- `hash`, the trail's evaluated-data hash: SHA-256 over each trace in order, its point count as a u32 little-endian,
  then each point's x, y and z as f64 little-endian.
- Asking for `trails` changes no pixel.

### `deep-gpu run`: `view3d`'s `particles` field for a ribbon

For a `particles@1` item drawn as a ribbon, each frame's `particles.<id>.hash` covers its ribbons: SHA-256 over the item's
rows in order, a row with a live particle as the byte 1 then its ribbon's `segments` + 1 points, j = 0 to segments, each
x, y and z as f64 little-endian, a row with none as the byte 0. Point j is the row's CPU f64 closed-form position at
t − j × (length ÷ segments), the step in whole flicks (rounded down), the same evaluation the `particles` call gives for
that row at that time; where that time falls before the particle's birth, its birth point. Every other draw's hash is
#449's, unchanged. `live` and `culled` are #449's.

### Document fields (the shapes the issue leaves open)

- **A trail** is a `mark.line@1` with `params.trail` and no `points`; its other params (`paint`) as the line's.
  `trail: {"of": "<item ID>[#anchor]", "span": s, "segments": n, "width": px, "taper", "fade", "space": "world" | "local", "window": …, "rate": Hz, "max_points": n}`:
  the issue's `trail` fields with `window`, `rate` and `max_points` inside it, every number bare in its field's unit
  (Units and axes: s, px, Hz). The source's world position is the item's evaluated origin through its channels,
  drivers, parents or a bake's outputs. The line's own `at` is left unset.
- **`window`**: `"span"` (the default, also when absent);
  `{"since": {"on": {"list": "markers.<kind>" | "input.<control>", "kinds"?, "tags"?, "where"?}, "until"?: {same shape}, "keep"?: n}}`,
  `on` and `until` bound as a driver's var binds a list (#491); or `{"whole": {"from"?: "<time literal>" | {"marker": "<marker ID>"}}}`,
  from the transport's start when absent.
- **A ribbon**: `draw: {"ribbon": {"segments": n, "length": s, "width": px, "taper", "fade"}}`, a one-key object as
  #449's emit shapes are.
- **A cue with a launch**: the base's marker, `"markers": {"<ID>": {"kind": "cue", "t": "<time literal>", "payload": {"angle": deg, "x": m}}}`,
  its payload read by drivers as `last(k).angle` and `last(k).x` over `"vars": {"k": {"list": "markers.cue"}}`.
- **A point on a rolling wheel** is an item parented to a rolling hub (`"parent": "hub"`), placed at (0, −r, 0) in the
  hub's frame; the hub's `at/pos/0` and `at/rot/2` are keyed by channels.

### Planted programs (`deep-gpu run --planted <name>`; `twins.json` maps each criterion to its names)

| Name | Criterion | The wrong program |
|---|---|---|
| `trail_appends_per_frame` | 4 | a `whole` trail draws, at each frame, the source's world position at every frame this process has drawn of the document so far, in order, ending with this frame's (a point appended per drawn frame), instead of the bake's samples before t and the source at t; `view3d`'s `trails` report is what it draws. The `trail` call's bake and the other windows are unchanged |

## Fixtures

All are built by `helpers.ts` and the test files as session documents (one writer layer, `seed: 450`), drawn with #449's
acceptance look (`tests/acceptance/449/fixtures/look.json`):

- `wheelDoc` (criteria 2, 4 and 5): a hub at height r = 0.5 m whose `at/pos/0` a channel keys linearly from 0 to 2π m
  and `at/rot/2` from 0° to −720° over the 4 s transport (θ = π t, a turn about −z, rolling along +x without slipping),
  carrying a tire and the point `rim` at (0, −0.5, 0), which is then at r(θ − sin θ, 1 − cos θ, 0); the line `trail`
  trails `rim`: with the default window, span 0.5 s in 16 segments (criterion 2), or with `window: {whole: {from: "0s"}}`,
  `rate: 60`, span 4 s (criterion 4).
- `throwDoc` (criteria 3 and 5): a 0.4 m ball whose x and y drivers throw it at 10 m/s under 9.81 m/s² from each cue at
  its payload's angle, resting where it lands (its flight time 2 v sin θ ÷ g) until the next cue, each throw starting
  where the last landed (x = 0, 8.828, 19.022 and 27.850 m); cues at 0, 2 and 4 s at 30°, 45° and 60°, and a fourth at
  6 s at 75°; the line `arcs` trails it with `window: {since: {on: {list: "markers.cue"}}}`, keep unset, 16 segments,
  span 8 s; an 8 s transport.
- `stormDoc` (`ac1`): 512 particles in two bursts of 256, at 0.1 and 0.9 s, from a 0.1 m ball, 2 to 5 m/s up a cone
  under gravity with drag 0.8/s, bouncing on a floor y = −1 and walls x, z = ±1.5 m (restitution 0.6, at most 3, then
  rest), with turbulence of strength 0.15 m, drawn as ribbons of 8 segments over 0.2 s.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`'s rule, computed by its `readIssue` from the live issue). Every test title starts
`AC<n> #450.<id>`.

| Criterion | File | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| AC1 `#450.bb75390f` particles' columns, seek equals play, with bursts, bounces, turbulence and trails | `ac1-ribbon-columns.test.ts` | The storm at 60 fps: frames 20, 61, 90 and 140 each sought in a fresh process have the played frames' evaluated-data hashes. Guards: the four differ, each has live particles; both bursts born, some bounce, a turbulence table; frame 90's hash is the ribbon hash of the `particles` call's CPU positions at 1.5 s and 1 to 8 steps of 0.025 s before (every live particle older than 0.2 s), some ribbon longer than 1 mm | a ribbon kept from earlier frames; a hash of the heads alone (a ribbon drawn as dots); a ribbon not from the particle's earlier ages |
| AC2 `#450.28ba84de` a trail sought equals played by evaluated-data hash | `ac2-trail-seek.test.ts` | The rim's span trail at 30 fps: frames 17, 41, 77 and 113 sought equal played by trail hash. Guards: one trace of 17 points, each the rim at t − (16 − i) ÷ 32 s within 1e-6 m; the hash is of those points; the four differ | a trail kept as a history of frames; a trail from anything but the source's evaluation at earlier times |
| AC3 `#450.b4182e2c` traces since cues, keep 3, seek by pixel hash | `ac3-since-traces.test.ts` | At 6 s: three traces starting at 0, 2, 4 s at each throw's start, peaking 1.27, 2.55, 3.82 m above it within 0.05 m, the first two ending at 2 and 4 s at the next trace's first point (1e-9 m), the third at t at the ball; with a fourth cue, at 7.5 s the traces start at 2, 4, 6 s; frames 20, 55, 100, 144 sought equal played by pixel hash, the four differing, drawing 1, 2, 3, 3 traces, each other than the document without its trail | traces recorded between frames; keep ignored or the newest dropped; a trace drawn to t past its end; a trail computed and not drawn |
| AC4 `#450.0ef4f21f` a whole trail on a rolling wheel | `ac4-whole-trail.test.ts` | The bake: a sample every 1/60 s (k × 11,760,000 flicks) from 0 through 4 s, each within 1e-9 m of the cycloid; at 1.37 s (100 fps, frame 137): 84 points, 0 to 82 the bake's samples bit for bit, 83 the reported source bit for bit, itself within 1e-9 m of the rim; frames 30, 82, 137, 200 sought equal played at 60 fps by trail hash (each the hash of its points, the four differing); at 24 and 60 fps the same polyline bit for bit at every m ÷ 12 s, at least 210 points at 3.5 s | `trail_appends_per_frame` (fails naming the time); a bake at the frame rate; samples drawn past t; a last point not at the source |
| AC5 `#450.1ac5b5e5` shown to you | `taste.test.ts` | Writes two screenshots and two recordings from `view3d`'s own final PNGs to `target/acceptance/450/`; reads `TASTE.json` (below) | none: it is a person's call |

Every test but the taste call fails at the base at the missing surface (`BASE-FAILURE.txt`). None can pass on a program
that does nothing: each reads hashes, points, samples or pixels the program must produce, and holds guards (live rows,
point counts, closed-form places, frames that differ, pixels that differ without the trail) that an empty or still
answer fails.

## Readings where the issue and design leave a choice

- **One host for trails.** The design puts `trail` on `mark.line` and on `path@1` in a writer layer on the GPU layer; these
  tests use the 3D `mark.line@1` drawn by `deep-gpu`'s `view3d`, the binary that draws particles too, so every reading
  (frames, pixel hashes, the bake) is one binary's.
- **"Evaluated-data hash".** For particles it is #449's, over the CPU f64 closed form, extended to cover each live row's
  ribbon, so "instance columns … with trails on" compare the ribbons too; for a trail, the polyline the frame draws. A
  test recomputes each hash from its reported points (or, for frame 90 of the storm, from the `particles` call), so a
  hash can't be of something else.
- **Times are whole flicks.** Ribbon steps (0.025 s), span steps (0.5 ÷ 16 s), 60 Hz samples (1/60 s), the cues and
  1.37 s are all whole flicks, so a seek, a play and the `particles` call evaluate at the same times bit for bit.
- **`span` with `since` and `whole`.** The design says `span` "still trims" a whole trail; the fixtures set span to the
  transport's length, so no trace or sample a criterion names is trimmed whichever way `span` reads with `since`.
- **The thrown item** is a ball its drivers move in closed form from `since(k)`, `last(k).angle` and `last(k).x`, with
  g = 9.81 m/s² (the issue's 1.27, 2.55 and 3.82 m are 10² sin²θ ÷ 19.62). Each throw starts where the last one landed,
  so "ending at the next start" is one place whether a trace's last point is read at its end's flick or just before
  it; the test reads the end's time (`end`) and place (the next trace's first point). A trace's peak is its highest
  point less its first point's height, the polyline as drawn with 16 segments (within 0.005 m of the true apex here, far
  inside 0.05 m). The newest trace has no next start and ends at t, at the ball.
- **"A fourth cue drops the 30° trace"** is read with the fourth cue at 6 s, at 7.5 s: the kept three start at 2, 4 and
  6 s.
- **"Seeking to any time"** is four frames each, spread over the span; criterion 3's compare pixel hashes, as it says,
  and also check that the document without its trail draws other pixels there, so the traces are in what's compared.
- **The rolling wheel** has r = 0.5 m and θ = π t (one turn each 2 s), rolling along +x; "within 1e-9" is on each axis,
  z included (0). The bake's samples run from 0 to the transport's end; 240 or 241 are accepted, as "up to the
  transport's end" may or may not include 4 s, though the README's surface includes it.
- **"Exactly at the point"** is bit for bit: the last point equals the frame's reported `source`, which is the rim within
  1e-9 m by the closed form; "draws the samples" is bit for bit against the `trail` call's bake.
- **1.37 s** is frame 137 at 100 fps, 966,672,000 flicks, so no frame rate rounds it.
- **"24 and 60 fps give identical polylines"** compares the two plays at the 49 times they share, m ÷ 12 s for m = 0 to
  48, point for point, bit for bit.
- **Criterion 2's guard tolerance** is 1e-6 m: it only shows the trail is the source evaluated again at earlier times
  (the criterion names no tolerance; criterion 4 holds the same chain to 1e-9).
- **Criterion 1's "bursts"** are `emit.bursts` (#449's timed bursts); its "trails" are ribbons, the particles' own trail.

## The taste call

`taste.test.ts` writes, from this run's own frames: `three-traces.png` (the thrown ball's three traces at 6 s, 640 × 360)
and `wheel-trail.png` (the rolling wheel's whole trail at 3.75 s), and `traces-24fps.apng` and `traces-60fps.apng` (the
thrown ball's traces from 0 to 6 s at 24 and at 60 fps, 320 × 180), all in `target/acceptance/450/`, printing each
SHA-256. Show them to the owner in the session and attach them to the PR; record the one answer in
`tests/acceptance/450/TASTE.json`:

```json
{"issue": 450, "criterion": "#450.1ac5b5e5", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"three-traces.png": "<sha256>", "wheel-trail.png": "<sha256>"},
 "recordings": {"traces-24fps.apng": "<sha256>", "traces-60fps.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge it.

## Not tested

Mesh draws (`draw: mesh`, `pick`, `orient`, `tumble`, `scale`, `stretch`), `cycle` and `links`, which no criterion reads;
a ribbon's `width`, `taper` and `fade`, and a trail's, which are looks only; the compute operator's ribbon columns against
the CPU (criterion 1 compares evaluated data); `path@1` trails in a 2D writer layer; `space: local`; `until`; `since` over
a control's entries; `whole.from` a marker; the bake keyed by the source chain's content keys and a re-bake from the
input track's fork; `max_points` and its refusal at check; `keep` past 8 refused; a trail of an item whose chain cost
wasn't counted; trails of a physics bake's outputs; the span window before t = span and a ribbon before its particle is
0.2 s old (only seek against play reads them); the trail costs.

## Upstream tests (the Oracle lane)

The oracle page lists no upstream test for any criterion. None is ported.

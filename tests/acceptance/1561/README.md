# Acceptance tests for #1561: the live window and the app draw drawn looks

Written from issue #1561 (its summary, Scope and three acceptance criteria), the design documents and base commit
`9550dc0f0` ("Merge pull request #2831 …"), by a job that saw no implementation. No other worktree, branch or pull
request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind
redraft of this job (design: Dogfooding).

The suite is lean: one file per criterion, six tests, and the two planted wrong programs the criteria name. Every
expected value is the issue's: a frame equal by pixel hash to another frame of the same run on the same machine.
There is no golden and no reference picture.

This README and `BASE-FAILURE.txt` were written after the tests, by the same blind job resumed. The three test files,
`helpers.ts`, `tsconfig.json` and the three fixtures were left byte for byte as first written; a fault found in them
on the way is listed under Open points, not fixed.

## What was read

- The issue's text. Its expected values are the only ones here.
- `docs/canvas-primitives.md`: Look `look@1` and its rows light, paper, line profiles and drawn fills (the Fields
  lines); Render-back (Fields, Semantics, It can never).
- `docs/technical-design.md`: Dogfooding (who writes these tests, and the redraft). AGENTS.md.
- At the base, for surfaces and conventions only: `crates/deep-gpu-layer/src/flat.rs` (its header, `is_flat`, `frame`,
  `build`), `live.rs` (a frame's time, the reply's view row), `film.rs` (its header) and `main.rs` (`Planted`, how an
  unknown name is refused); `crates/deep-show/src/main.rs` (the `frames` call's fields) and `frames.rs` (`frames`);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs` (`alone`), `scripts/throttle.mjs` (its answers);
  the suites `149/` (README, `TASTE.json`) and `1929/` (README, `BASE-FAILURE.txt`).
- That list is the resumed session's. The first session's reading is on record only in what the test files cite:
  `film2d` (#417, #149), `live` (#379, #397) and `deep-show run` (#393).

Code was read only to learn the surface.

## What the base already does, which these tests don't credit

Seen in the base run (`BASE-FAILURE.txt`) and in the code named above:

- `film2d` draws the boat fixture with all five things in the picture. The guards of criterion 1 pass at the base.
- `flat.rs` draws a 2D document in the live window in the look's roles, over the look's ground as one flat color. It
  takes a document only when the document names no camera (`is_flat`). The boat fixture names one, and its live frames
  at the base are blank: one color in every pixel.
- `flat.rs` already reuses the last frame's marks when items only moved by `at.pos`. At the base the leaf fixture's
  frames 5 and 9 at 4 frames a second already equal frames 2 and 3 at 1 frame a second by pixel hash. A guard fails
  them: the full redraw is the frame the look draws with its drawn fields removed, so there is no fill or paper in it
  to keep.
- A `live` view row has `session`, `drawn` and, with `capture`, `final`. It has no `reused`.
- `deep-show run` presents the document, which names the look by asset, and its `frames` call with `pixels` answers a
  `pixel_hash` per frame that names a PNG in the evidence store. The issue says these frames take the look's roles
  and fonts only. Its three frames of the boat are one picture, not blank, and not `film2d`'s.
- `deep-gpu run --planted <name>` with a name it doesn't know answers `{"ok": false, "code": "bad_input"}`.

## Run them

Each file builds `deep-gpu`, and two also build `deep-show`, and all drive the GPU, so they run one file at a time.
`scripts/lanes.mjs` needs this folder in its `alone` list, as `tests/acceptance/149/` is. This README is the
instruction; the implementer makes that edit, and this job edits nothing outside its folder.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs test --wait 30 -- \
  npx vitest run --root tests/acceptance/1561 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/1561/tsconfig.json    # type-check
rm -rf tests/acceptance/1561/node_modules    # the test runner's cache, not part of the suite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-gpu` (and `--bin deep-show` where it drives it),
  with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`. It copies the
  binary out of the target folder and fails each test that uses a failed build with cargo's error. No cargo fails
  them with `BLOCKED: cargo could not run` in the failure, never a pass. The pinned 1.99.1 toolchain's folder is added
  after `PATH`, so a cargo already on `PATH` wins.
- **Platform.** Every test draws on macOS's GPU device. Anywhere else each test fails `INCONCLUSIVE:`
  (`requireMetal`), never passing. A reply with `code: "unsupported_platform"` reads `INCONCLUSIVE:` too.
- **One machine.** Every comparison is between frames of one run on one machine, as criterion 1 says.
- **Isolation.** Each test writes into its own temporary folder and deletes it. The one thing written inside the
  checkout is the taste test's two screenshots, under `target/acceptance/1561/`. Node built-ins and the test runner
  only.
- **Timeouts.** `helpers.ts` sets the runner's timeouts (`vi.setConfig`), so they hold under any root. A binary that
  runs past 15 minutes is stopped by the spawn's own timeout, which signals only that child.
- **The base run** (`BASE-FAILURE.txt`): 6 tests, 6 failed, about 60 s. Three fail at their judge's assertion. The two
  planted-program tests fail before their judge, where the base refuses the unknown planted name. The taste test
  reads `INCONCLUSIVE:`.

## The surface under test

**No new binary, no new call and no new request field.** The tests enter through `deep-gpu run [--planted <name>]`
and `deep-show run`, both at the base, with their JSON-lines protocols unchanged: one scenario per input line, one
answer per line, `{"ok": true, "replies": […]}` with one reply per call, exit 0. A `deep-gpu` scenario is
`{"out": "<folder>", "calls": […]}`, one process per scenario. They add **one field on a `live` view row** (`reused`)
and **two planted names**. Those three names are this job's choice (Open points); the implementer provides exactly
these, or disputes them.

A `film2d` or `live` reply that carries a `code` was refused, and the test fails, showing it.

### The three paths and their frame numbers

| Path | Call | Frames are numbered | A frame's time |
|---|---|---|---|
| The reference | `film2d` in `deep-gpu run` | from 0 | frame n at t = n ÷ fps |
| The live window (`flat.rs`) | `live` in `deep-gpu run`, on a writer's payload | from 1 | frame k at t = (k − 1) ÷ fps |
| deep-show's frame path | `frames` with `pixels` in `deep-show run` | from 0, by place in the reply | frame k at t = k × `step` |

So at 4 frames a second, t = 0, 0.5 s and 1 s are `film2d`'s frames 0, 2 and 4, the live window's frames 1, 3 and 5,
and deep-show's frames 0, 2 and 4.

### `film2d` (#417, #149), as at the base

```json
{"call": "film2d", "doc": {…}, "look": {…}, "fps": 4, "frames": 5, "capture": [0, 2, 4]}
```

- `doc` is the fixture inline, with its `id`, its `layers` and each item's `layer`. `look` is the look@1 inline.
- The reply's `frames` holds a row `{"frame": n, "final": sha256}` for each captured frame. `<final>.png` is under the
  scenario's `out`, and the file's SHA-256 is its name.

### `live` (#379, #397): one field added

```json
{"call": "live", "look": {…}, "fps": 4, "frames": 5, "capture": [1, 2, 3, 4, 5],
 "sessions": [{"session": "view", "writer": "agent:a", "doc": "<path to the payload>"}]}
```

- The payload is the fixture as a writer sends it: no `id`, no `layers`, no item `layer`. It is a JSON file in the
  test's temporary folder. The call gives no `size`; the view is the document's, 480 × 270.
- `capture` lists every frame, 1 to `frames`.
- The reply's `sessions` lists the session; its `state` is not `refused` (the failure shows its `issues`).
- The reply's `frames` holds `{"frame": k, "views": […]}` for every frame. The session's view row is the one whose
  `session` is `view`. The tests read three of its fields:
  - `drawn`: `true` when the view drew this frame. A frame that changes nothing isn't drawn again, so criterion 1 and
    the taste test take the view's latest drawn frame at or before k. Criterion 2 needs each frame it reads drawn.
  - `final`: as `film2d`'s, the drawn frame's `<final>.png` under `out`.
  - **`reused`** (added): `true` when the frame reused the last frame's marks, moved, as `flat.rs` does for a frame
    whose items only moved by `at.pos`; `false` when the frame was laid out in full. Criterion 2 needs `true` and
    `false` exactly; a row without the field fails both.

### `deep-show run` (#393) and its `frames` call (#856), as at the base

```json
{"evidence": "<folder>", "sessions": {}, "processes": […], "panels": {"main": {"rect": [0, 0, 480, 270]}},
 "docs": {"01JB1561D00000000000000001": {"panel": "main"}},
 "calls": [{"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": "01JB1561D00000000000000001",
            "document": {…}, "include": ["issues"]},
           {"call": "frames", "doc": "01JB1561D00000000000000001", "count": 5, "step": "15f", "pixels": true}]}
```

- `document` is the writer's payload plus `"look": {"asset": "drawn-live-1561@1", "theme": "light"}` and
  `"assets": {"drawn-live-1561": {"sha256": …, "license": {…}}}`. The look's JSON is in the evidence store under its
  SHA-256, at `<evidence>/<first 2 hex>/<the other 62>`.
- The first reply's `outcome` is `presented`.
- The second reply's `frames[k]` holds `t`, in flicks, exactly k × 705,600,000 ÷ 4 (`step` is `15f`: 15 frames at 60 a
  second, 0.25 s), and `pixel_hash`, a SHA-256 that names the frame's PNG in the evidence store at
  `<evidence>/<first 2 hex>/<the other 62>`. The file's SHA-256 is its name.
- In criterion 1 one `deep-show run` process takes six scenarios, one line each, each a fresh run of the hub: the
  fixture, then the fixture with each of the five things removed. The taste test's takes one.

### What the judges say, and what the program is not asked to say

The criteria's "naming the first field it dropped" and "naming the frame" are the suite's judges' words, built from
frames. No program is asked to print them.

- Criterion 1's judge lists each compared frame that isn't `film2d`'s, as
  `<path>'s frame <k> (t = <s> s) isn't film2d's frame <n> at the same t: pixel hash <a> against <b>`, with
  `; it is blank` when it is. Then one line: `the first field <path> dropped is <field>: it draws the same three frames
  with and without it`, or `<path> dropped none of the five whole (…): its frames change when each is removed`.
  `<path>` is `the live window` or `deep-show's frame path`. `<field>` is one of `the named fill`, `the line profile`,
  `the paper`, `the light`, `the 2D camera`, in the criterion's order.
- The planted test of criterion 1 needs a failure that says `the first field the live window dropped is the named fill`.
- Criterion 2's judge says `frame <k> (t = <s> s), which only moved, isn't the full redraw at the same t: pixel hash
  <a> against <b>`. Its planted test needs `frame 5 (t = 1 s), which only moved, isn't the full redraw at the same t`.

### Files the run writes

`taste.test.ts` writes `target/acceptance/1561/live-window.png` and `target/acceptance/1561/deep-show.png`, and
prints each file's SHA-256. Nothing else is written outside temporary folders. `tests/acceptance/1561/TASTE.json` is
read, never written, by the suite.

## The fixtures

All 480 × 270, `profile: figure`, `seed: 1561`, one writer layer `main`.

- **`fixtures/look.json`**, the drawn look `drawn-live-1561`: a look@1 with `basis: drawing`. The fixtures paint in
  its roles `accent`, `ink`, `paper`, `vermilion`, `moss`, `ochre`, `wine` and `shade`.
  - The named fill: `fills.pool`, a `wash` (`pool: 0.6`, `granulation: 0.4`, `blooms: {count: 3, size: 40}`,
    `bleed: 3`, `wet_in_wet: true`, `oversize: 0.1`, `seed: "item"`).
  - The line profile: `lines.nib`, `exact`, `width: 6`, with `profile: {taper_in: 0.3, taper_out: 0.4, swell: 0.5,
    seed: 5}`.
  - The paper: `ground: {kind: "paper", params: {…}}` in the role `paper`, with `tooth: {kind: "cold_press",
    scale: 14, depth: 0.3, seed: 3}`, `age: {stains: {count: 12, size: 40, role: "ochre"}, foxing: 0.2}`,
    `anchor: "world"` and `zoom: "crossfade_octaves"`.
  - The light: `dir: 135`, `elevation: 45`, one `rim` (`vermilion`, `width: 3`, `dir: 160`, on the collection `lit`),
    `cast: {role: "shade", length: 14, softness: 3}`, `weight: 0.6`.
- **`fixtures/paper-boat.json`** (criteria 1 and 3): a paper boat on a pond, 2 s long. `pond` (a `rect@1`) and `hull` (a
  `path@1`) take the fill `pool`; `hull`, `sail` and `reed` take the line `nib`; `sun` is a `circle@1`. The collection
  `lit` holds `hull`, `sail` and `sun`. The envelope's `camera` names `cam`, a `camera@1` with
  `projection: orthographic`, `target: [240, 135, 0]` and `view_width: 480`. Two channels move it over the 2 s:
  `dolly` takes `target/0` from 240 to 320 and `push` takes `view_width` from 480 to 400. At t = 0 the camera shows
  the page as a document with no camera does, so the camera is in the picture at 0.5 s and 1 s only.
- **`fixtures/blown-leaf.json`** (criterion 2): a leaf over a pond, 4 s long, no camera. `pond` takes the fill `pool`
  and `bank` the line `nib`. `leaf` is a plain `rect@1` in the role `ochre`, with `at.pos`; the channel `drift` takes
  `items/leaf/at/pos/0` from 0 to 240 over the 4 s. `buoy` is a `circle@1`; the channel `bob` holds its `r` at 8, 12,
  8, 12, 8 from 0 s, 0.5 s, 1.5 s, 2.5 s and 3.5 s. It is drawn under the look without its light.
- **Made in `helpers.ts`**:
  - `without(field)`, the look and the boat with one of the five removed: `fills.pool` set to `{kind: "flat"}`;
    `lines.nib.profile` deleted; `ground` set to `{kind: "flat"}`; `light` deleted; or the document's `camera`, its
    `channels` and the item `cam` deleted.
  - `plainLook()`, the look with the first four removed: its roles on a flat ground.
  - The writer's payload: the fixture without `id`, `layers` and each item's `layer`.

## The pixel hash

Each path keeps a frame as a PNG named by the file's SHA-256: `deep-gpu` as `<final>.png` under `out`, deep-show in
its evidence store under `pixel_hash`. The suite reads that file, checks that it hashes to its name, decodes it, and
checks that it is 480 × 270. A frame's pixel hash is the SHA-256 of its RGBA8 rows, top-down, 4 bytes a pixel. Two
frames are equal when those are equal.

- The decoder is the suite's own (`decodePng`): 8-bit RGB or RGBA, no interlace, the five row filters. An RGB file's
  alpha is read as 255. Any other PNG throws, and the test fails.
- A frame is blank when every pixel is one color. `film2d`'s blank frame is `BLOCKED:`. A blank frame from another
  path is said in its failure line.
- **Why not the calls' own hash strings.** `final` and deep-show's `pixel_hash` are hashes of PNG files. Two paths
  that draw the same pixels and write them with another color type, filter or compression would differ, and the
  criterion asks for equal pixels, not equal files. Hashing the decoded rows gives one hash across the two binaries
  and the three calls, and the suite doesn't take a program's word for its own pixels.
- No picture is read for more than its size, its hash and whether it is blank.

## Planted programs

Each is reachable only through `deep-gpu run --planted <name>` and changes nothing else. Its process must accept the
scenario, answer every call and exit 0; the judge that passes the shipped program must then fail on it, saying what
its criterion says. A name the build doesn't know is refused (`{"ok": false, "code": "bad_input"}`), as at the base,
and the test fails there.

| Name | The wrong program | Criterion | What the test holds it to |
|---|---|---|---|
| `live_passes_no_page` | The live window hands `flat.rs` no page and none of the look's drawn fields, so the boat draws in plain role colors | AC1 (issue-named) | At least one of its frames 1, 3 and 5 isn't `film2d`'s, and its three frames are the same with and without the wash, so the judge says `the first field the live window dropped is the named fill` |
| `reuse_drops_page` | A frame that reuses the last frame's marks is drawn with no page; a full redraw is untouched | AC2 (issue-named) | Its frame 5 at 4 frames a second isn't frame 2 at 1 frame a second, and the judge says `frame 5 (t = 1 s), which only moved, isn't the full redraw at the same t` |

There is no planted deep-show path: the criteria name none.

## Criteria to tests

IDs are `#1561.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with `AC<n> #1561.<id>`.
Each file's header states its fixture, frames and guards in full.

| ID | Criterion | File: tests, and what each asserts |
|---|---|---|
| `AC1 #1561.785c8c1d` | A 2D document under a drawn look with a named fill, a line profile, paper, light and a 2D camera draws in the live window (`flat.rs`) and through deep-show's frame path equal by pixel hash, on one machine, to `film2d`'s frame at the same t; a planted live path that passes no page draws plain role colors and fails, naming the first field it dropped | `drawn-look.test.ts` (3). **Guards**, before any comparison, drawn once for the file by the first test that gets through them: `film2d`'s frames 0, 2 and 4 of the boat aren't blank, differ from the boat under `plainLook()`, are three pictures, and frames 2 and 4 differ when any one of the five is removed. (1) "the live window draws the fixture at t = 0, 0.5 s and 1 s, the camera moved at the last two, equal by pixel hash to film2d's frames at the same t": the `live` call's frames 1, 3 and 5 equal `film2d`'s 0, 2 and 4. (2) "deep-show's frame path draws the fixture at t = 0, 0.5 s and 1 s, the camera moved at the last two, equal by pixel hash to film2d's frames at the same t": `frames`' 0, 2 and 4 equal `film2d`'s 0, 2 and 4. (3) "planted live_passes_no_page, a live window that passes no page, draws plain role colors and fails, naming the named fill as the first field it dropped": the same judge as (1) fails on the planted program and names the named fill |
| `AC2 #1561.4606f756` | A frame that only moved, which reuses last frame's marks in `flat.rs`, keeps its fills and paper: it equals a full redraw at the same t by pixel hash; a planted reuse that drops the page fails, naming the frame | `moved-frame.test.ts` (2). One process plays the leaf three times in the live window: 9 frames at 4 frames a second, 3 frames at 1, and 3 frames at 1 under `plainLook()`. (1) "frames 5 and 9 at 4 frames a second reuse the last frame's marks and equal by pixel hash the full redraws at t = 1 s and t = 2 s": frames 5 and 9 have `reused: true`; frames 2 and 3 at 1 frame a second have `reused: false`; 5 equals 2 and 9 equals 3. **Guards**: the full redraw isn't blank, isn't the same frame under `plainLook()`, and frames 5 and 9 aren't frames 4 and 8. (2) "planted reuse_drops_page, a reuse that drops the page, fails, naming frame 5": the same judge fails on the planted program and names frame 5 |
| `AC3 #1561.ca22b9de` | Shown to you: screenshots of the drawn-look fixture in the live window and in deep-show, taken by the check run from the app, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `taste.test.ts` (1). "the run writes the fixture's screenshot from the live window and from deep-show, and the recorded call on exactly those says they look right": below |

Test count: 3 + 2 + 1 = 6.

In criterion 2, frames 5 and 9 at 4 frames a second follow frames at 0.75 s and 1.75 s with no step of the buoy
between, so only the leaf moved. Frames 2 and 3 at 1 frame a second follow frames at 0 and 1 s with a step between,
a change that isn't an `at.pos`, so they are laid out in full.

## The taste call

`taste.test.ts` draws the boat under the look at t = 1 s, the camera moved, through the two calls criterion 1 uses. It
writes each path's own frame, byte for byte its PNG, to `target/acceptance/1561/`: `live-window.png`, frame 5 of the
`live` call at 4 frames a second, and `deep-show.png`, frame 4 of `frames`. It prints each file's SHA-256, and says
which is blank.

**The owner makes the call, not this job and not the implementing agent.** The implementing run shows the owner the
two files in the session, attaches them to the PR, and records the owner's answer in
`tests/acceptance/1561/TASTE.json`. This job wrote no `TASTE.json`.

```json
{"issue": 1561, "criterion": "#1561.ca22b9de", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"live-window.png": "<sha256>", "deep-show.png": "<sha256>"}, "note": "…"}
```

The test reads it in this order:

1. No file: `INCONCLUSIVE:`, listing the two files and their hashes. This is not a pass.
2. Not JSON, or not an object: the test fails.
3. A key that doesn't hold, and the test fails naming it: `issue` is the number 1561; `criterion` is
   `#1561.ca22b9de`; `verdict` is `looks_right` or `looks_wrong`; `who` is a string that isn't blank; `when` is a
   string that parses as a time (ISO 8601); `screenshots` is an object whose keys are exactly `live-window.png` and
   `deep-show.png`.
4. A recorded hash that isn't the SHA-256 of the file this run wrote: `INCONCLUSIVE:`, a call made on other
   pictures. The hash is of the PNG file, the one the test prints, not the pixel hash.
5. Either screenshot blank: `BLOCKED:`, the call judged nothing.
6. `looks_wrong`: the test fails, with `note` when it is a string.
7. `looks_right`: the test passes.

`note` is optional. No other test reads these pictures or the call, and criteria 1 and 2 read no picture for more
than its hash.

## Open points

Each is a choice this job made where the issue or the design leaves one, or something the suite doesn't hold that a
reader might think it does. Any may be disputed.

1. **Written after the tests.** This README and `BASE-FAILURE.txt` came second, from the same blind job resumed, with
   the tests as first written. Where a test and this README differ, the test is what runs.
2. **"The live window (`flat.rs`)"** is `deep-gpu run`'s `live` call on a writer's payload, the base's entry to
   `flat.rs`. No window on a screen is photographed.
3. **"deep-show's frame path"** is `deep-show run`'s `frames` call with `pixels: true`.
4. **"At the same t"** follows each call's own numbering at the base (the table above). The times are 0, 0.5 s and
   1 s at 4 frames a second; the issue names none.
5. **The camera at t = 0** shows the whole page, so the camera is held at 0.5 s and 1 s only.
6. **The boat names a camera, and the base's `flat.rs` takes only documents that name none.** The criterion says such
   a document draws in the live window; how the live window tells a 2D document with a camera from a 3D one is the
   implementer's.
7. **`reused`** is this job's name and place for what the criterion calls "reuses last frame's marks". The base has
   no way to see a reuse from outside. Without it a program that redraws every frame would pass criterion 2 by
   drawing well.
8. **`reused: false` on the 1-frame-a-second frames** assumes the base's rule stays: a frame reuses marks only when
   items moved by `at.pos` alone. A program that came to reuse marks across a change of radius would fail here though
   the issue doesn't forbid it.
9. **"A full redraw at the same t"** is the same document played at 1 frame a second, where a step of the buoy falls
   between frames. No flag turns reuse off.
10. **Criterion 2 runs without the light and without a camera**, and the item that moves has a plain role fill. It
    holds the paper and a still item's wash and line in a reused frame, as the criterion's "fills and paper" reads. A
    reuse that drops the light or the camera, or the named fill of the item that moved, isn't caught.
11. **The planted names** `live_passes_no_page` and `reuse_drops_page` are this job's, after the criteria's words.
12. **"Naming the first field it dropped"** is done by the judge: it draws the fixture with each of the five removed,
    in the criterion's order, and the first whose removal changes none of the three frames is named. A path that
    drops a field in part gets "dropped none of the five whole", and no field is named.
13. **"Draws plain role colors"** isn't held to a picture of plain role colors. The planted test holds that the frames
    differ from `film2d`'s and are unchanged by removing the wash. At the base the live window's blank frames meet
    both, so the same line is printed there.
14. **Light theme only.** `film2d` and `live` take the look inline; deep-show's document names it by asset with
    `theme: "light"`. The dark theme isn't drawn.
15. **One document, one session, one panel.** Text and fonts, two writers, a resized view and a paused view aren't
    drawn.
16. **Only the fields in the fixture.** The other drawn fills (`ink`, `spatter`, `offset`, hatch), the other tooth
    kinds and age marks, `relief`, back lamps and collection targets aren't drawn here; #149's suite holds them on
    `film2d`, `layers` and `view3d`.
17. **The Scope's "hand … the look's drawn fields and a page, as `film2d` does"** is read only through pixels. No test
    reads how the page reaches `flat.rs` or deep-show.
18. **The taste call's `who`** is any string that isn't blank. The suite can't tell the owner from anyone else, and
    it can't see that the screenshots were attached to the PR or shown in the session; those are the implementing
    run's to do and the owner's to see.
19. **The taste call is tied to PNG files**, so it holds on the machine and build it was made on. A run whose files
    differ by a byte reads `INCONCLUSIVE:` until the owner looks again.
20. **The screenshots are one moment**, t = 1 s. The motion isn't shown.
21. **`BLOCKED:` for a blank screenshot comes after the call exists.** With no call recorded the test reads
    `INCONCLUSIVE:` even when a screenshot is blank, as at the base; the printed list marks the blank one.
22. **A PNG the suite's decoder can't read** (16-bit, palette, interlaced) fails the test with a thrown error, not
    with a judge's line. Both binaries write 8-bit RGB or RGBA at the base.
23. **`scripts/lanes.mjs`.** Only its `alone` list was read. Whether a file here also belongs in another of its lists
    wasn't checked.
24. **No timing.** The cost of a reused frame against a full redraw isn't measured; no criterion asks.

## What the implementer adds outside this folder

- The `scripts/lanes.mjs` edit under Run them.
- In `deep-gpu`: `reused` on a `live` view row, and the two planted names.
- `tests/acceptance/1561/TASTE.json`, once the owner has made the call. It is the one file under this folder the
  implementing run writes.

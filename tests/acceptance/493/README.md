# Acceptance tests for #493: shots: camera moves on camera@1, framing to a bound, transitions and reduced motion

Written first, from issue #493 (its Scope, its Fields, its 20 acceptance criteria, its Proof line: "Recordings of a
shot list (push, orbit, cut, log zoom, a glide into a stage's shot), the framing fixtures and their planted framers, and
the 2D push sealed without scene3d", and the comment that moved #491's cut transitions here: cross_fade, wipe {angle,
feather}, push {angle}, zoom_through {center} and their reduced-motion cross-fades), the design sections it names and
those they lean on, its Oracle page, and base commit `a4d2c5d4` ("Merge pull request #1610 …", origin/main), by a job
that never saw an implementation; none existed, and no other worktree, branch, PR or stash was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 493 --repo windoliver/deepbuild`), with its one comment. 20 criteria: 19 functional
  and the "Shown to you" taste call, AC20 here as on the Oracle page.
- Its Oracle page, `doneright/oracles/issues/493.md` on branch `doneright` of `DeepBuildAI/deepbuild`: one mapped
  criterion (11), inari's IEEE 1788 suite; the vendored `tests/itf1788_tests/libieeep1788_elem.rs` was read and its exp
  and sin cases ported (Upstream tests, below).
- `docs/technical-design.md`: Films and figures on the canvas (the timeline and camera shots bullet); Dogfooding; Tests
  written first.
- `docs/canvas-primitives.md`: Camera `camera@1`, its lens, its framing, goto and edge pan; Shot; Shot: poses from logic;
  Overlay and Overlay: clamped to the edge; Marks in 3D and Marks in 3D: lines; Transition and Transition: operator, iris
  and dip; Transport; Clip; Placement; Marker; Channel and key; Driver; Look `look@1` with its tone mapping, samples,
  frame history and indexed basis; Motion blur and Motion blur: velocity; Frame and group: parallax; Text animator and
  counter (and its selectors); Document envelope; Writer layer; ID and sub-address; The order of one evaluation; the
  closed function list's row (interval forms) in Registries and closed lists; Path `path@1`: function (how an interval
  form settles or refuses a range).
- At the base: AGENTS.md; `crates/deep-motion/src/main.rs` (`eval`, its answer, `planted`, `look`, `view`); in
  `crates/deep-canvas-motion/src/doc.rs` the stage shots (`shot_of`: `hold` only, `target`, `join`), `cameras_of`, the
  markers and `cuts_of` (a transition other than a cut is refused `transition_kind`); `crates/deep-canvas/src/camera.rs`
  (`Spec`, `Rig`, `Pose`, the framing solve, `Projector`; its conventions: azimuth 0 puts the eye on +Z of the target,
  the field of view spans the wider side); `crates/deep-canvas/src/draw.rs` and `render.rs`; `crates/deep-show` (its
  Cargo build sets `core`, `r1`, `r2`, `full` and test features, `run` scenarios, the calls `deep show`, `eval` (with
  `pixels`, `view`), `fn` (`over` → `bounds`, `planted`), `registry`; `frames.rs`'s canonical Vello CPU PNG stored in the
  evidence store; `snapshot.rs`'s `marks`); `crates/deep-canvas-marks` (the shipped `clean` look, `finish.rs`'s tone
  maps, the text module's animator, which already keeps only opacity under reduced motion); the merged blind suites
  `tests/acceptance/492/`, `491/`, `490/` (deep-show builds, `fn`, a planted build refusing with `module_missing`),
  `372/` (camera@1's pose JSON), `387/`, `388/`, `1162/` (looks by hash in the evidence store, PNG decoding, records with
  a verdict's state), whose layout and conventions this one follows; `scripts/proof-change.mjs` (criterion IDs).

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/493 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/493/tsconfig.json   # type-check (exits 0)
```

`cargo` must be on PATH. `--root` keeps the repo's `vitest.config.ts` out. It leaves Vitest's cache in
`tests/acceptance/493/node_modules/.vite`; delete it, it is not part of the suite.

Each file builds what it uses once, in `beforeAll`, and copies the binary out under its own name: `cargo build --locked
--bin deep-motion`, and `cargo build --locked --bin deep-show --no-default-features --features <set>` for each set it
lists (`full` everywhere; `seal.test.ts` also `r1` and `r1,test-camera-in-scene3d`). Every test of a file fails when its
build fails. The files build cargo binaries, so they run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/493/'` added to its `alone` list (this job writes only this folder; the implementer makes that edit).
Every `it` passes `TIMEOUT` (30 min). The issue states no timings, so nothing is timed. Node built-ins and vitest only.

## The surface under test

The issue names fields, moves, refusals and observations but no code API, so these tests extend the two surfaces the
base already has for motion and for the canvas: `deep-motion eval` (#391's JSON lines, as #417, #489, #490, #491 and
#492 extended it) for poses, framing and refusals, and `deep-show run` (#393's scenarios) for what is drawn: sealed
builds, pictures, and the film's evaluated data. No new binary or subcommand. **Every name below that the issue or the
design doesn't give is this job's choice** (each is listed again under Choices), the smallest surface consistent with the
design and the base; the implementer builds exactly these, or a dispute goes to a blind redraft. The tests judge values
(distances, angles, ratios, pixels, refusal IDs), never how they were reached.

### Pose (one JSON shape, everywhere a camera's pose is reported)

#372's camera JSON plus roll and the active shot:

```
Pose = {"position": [x, y, z], "target": [x, y, z], "azimuth": deg, "elevation": deg, "distance": m, "fov": deg,
        "view_width": m | u, "zoom": number, "roll": deg, "shot": shot ID | null}
```

Every field f64 and present (`shot` may be null). Conventions are camera@1's at the base: 3D in m, +Y up, the eye at
`target + distance · (cos el · sin az, sin el, cos el · cos az)`, fov across the wider side; a 2D (orthographic) camera
in u with y down, `position` equal to `target`. The tests mostly read `position`, `target`, `view_width` and `roll`, and
derive the rest: the aim is `target − position`; its yaw `atan2(aim.x, −aim.z)` (positive turning right, toward +X, as
a pan at angle 0 turns); its pitch `asin(aim.y ÷ |aim|)` (positive up); the eye's azimuth about the target
`atan2(position.x − target.x, position.z − target.z)`. A shot's pose writes the camera's own pose: the frame reports the
pose the camera is drawn through at t (the active shot's, a glide's, a transition side's at a whip), with the camera's
own kick applied.

### `deep-motion eval`

Input, as at the base, `{"doc", "times": [flick], "planted"?, "look"?, "view"?: {"reduced_motion": bool}}`, plus:

- `project?: [item ID]`: each frame reports `projected.<ID> = {"center": [x, y], "box": [x0, y0, x1, y1]}` in px of the
  document's `size` (1 u = 1 px; origin top left, y down), through the pose the frame reports for the document's camera
  (envelope `camera`): `box` is the bounding rectangle of the projections of the item's evaluated bounds' corners (8 in
  3D, 4 in 2D), `center` the projection of the bounds' center point. `mark.box@1 {size}` is a box of that size centred
  on its position; `rect@1` is its `params.box` moved by its position.
- `look.motion_blur?: {shutter_angle: deg = 180, samples: n = 8}` on the eval line's look@1 object.

Output, as at the base, plus:

- In each frame, `cameras.<camera ID>` is a Pose (the base reports only `target`). While a frame lies inside a declared
  move and the eval line's look carries `motion_blur`, it also carries `blur: [{"t": flick, "shot": shot ID, "pose":
  Pose}]`: the sub-samples the frame averages (Motion blur: stratified over the shutter centred on t), each with the
  shot whose side it draws.
- In the answer, `shots: {<shot ID>: {"framed": Pose, "union": {"lo": [x, y, z], "hi": [x, y, z]} | null}}` for every
  shot: its one framed pose (Shot: an explicit pose, or the keep fit) and the kept items' union bound over its span that
  the fit used (null without `frame.keep`), as the bound the camera.framing check reads.
- Refusals, as at the base, `{"ok": false, "code", "path", …}`, whose whole JSON the tests search for the IDs a refusal
  must name; no code is pinned. A framing bound that can't settle carries `span: [from, to]` in flicks.
- `planted`: the names under Planted programs; any other value stays `bad_input`.

### `deep-show run`

The scenario and calls as #393, #387, #490 and #1162 left them: `deep show` of a whole document (the payload carries no
`layers` and no item `layer`; the hub stamps them), `eval` at a flick with `pixels` and `view: {reduced_motion}`
(`snapshots: [{sha256, w, h, marks, legend}]`, each mark `{item, state, color: [r, g, b], bounds: [x, y, w, h]}` in px, the PNG at its SHA-256 in the evidence store), `fn` with `over`
(`bounds: [{lo, hi}]`), `registry` (`modules`, `kinds`). New:

- `eval`'s `film: true` adds `film: {"cameras": {<camera ID>: Pose}, "dissolve": null | {"mix": 0..1, "from": Pose,
  "to": Pose}, "parallax": {<group ID>: [x, y]}, "glyphs": {<text item ID>: [{"x", "y", "opacity"}]}}`: the camera's
  evaluated pose at t; the dissolve a reduced-motion cut draws (`mix` the incoming pose's share, `from` and `to` the two
  poses blended), null when none draws; each parallax group's offset in u (Frame and group: parallax); each text item's
  glyphs in order, `x` and `y` the glyph's drawn origin in u after its animators, `opacity` 0 to 1.
- `fn`'s `planted` also takes `rounds_to_nearest`.
- The Cargo feature `test-camera-in-scene3d` (a test build, beside #490's `test-ease-in-motion`): camera@1 registered by
  the scene3d module instead of the core, so with `r1` it is a build with no camera@1.

### Documents

#391's envelope (`{format: 1, id, profile: "film", title, description, size, camera, layers, transport, items, …}`;
`layers` only for `deep-motion`), with:

| Field | As the tests write it |
|---|---|
| Shot | `shots: {ID → {start, end, camera, move, ease?, by?, angle?, frame?: {keep, fill?, place?}, target?, orbit?: {azimuth, elevation, distance}, view_width?, roll?, join?, keyed?, essential?, shake?, look?}}`, times as text (`"1s"`) |
| Moves | `"hold"`, `"push"`, `"pull"`, `"pan"` (with `angle`), `"orbit"`, `"log_zoom"`, `"lens_zoom"`, `{"follow_forward": item ID}` |
| Shot shake | `shake: {by, hz, roll}` riding any move |
| Shot look | `look: <asset ID>`: a look@1 in the document's `assets` (`{sha256, license}`), its JSON in the evidence store at its SHA-256, as the document's own `look: {asset: "<id>@1"}` names one (#1162) |
| Transition | `transitions: {ID → {from, to, kind, span, progress?, match?}}` with the kind's own fields under its name: `wipe: {angle, feather}`, `whip: {angle, sweep}`; `progress: "linear"` names the progress ease; `match: {from: item, to: item}` on a cut |
| Camera kick | `kick: [{at: [time], by, s, hz}]` in the camera@1 item's `params` |
| Parallax | a `group@1` with `params.parallax: {rate, drift}`; its children name it as `parent` |
| Text animator | as the base's text module reads it: `params.animators: [{units, range: {from, to, falloff, offset}, shape, mode, props: {y, opacity}}]` |
| Status binding | `status_bindings: {ID → {target: "items/<id>/params/paint/fill", source: verdict handle}}`, the scenario's `record` giving the verdict's `state` |
| Driver | `drivers: {ID → {target, expr, vars: {t: "time"}}}`, as at the base |

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `log_zoom_eases_width` | eval `planted` | 1 | a log zoom that eases the view width, not its logarithm |
| `test-camera-in-scene3d` | deep-show build feature | 2 | camera@1 registered in scene3d |
| `framer_samples_30hz` | eval `planted` | 10 | framing that bounds the kept items from 30 samples a second |
| `rounds_to_nearest` | `fn` `planted` | 11 | interval forms whose ends round to nearest, not outward |
| `framer_fits_samples` | eval `planted` | 11 | framing that fits the frames' samples, never refusing a bound it can't settle |
| `lens_zoom_eases_fov_degrees` | eval `planted` | 13 | a lens zoom easing the field of view in degrees |
| `lens_zoom_dollies` | eval `planted` | 13 | a lens zoom that dollies the camera at its starting field of view |
| `whip_eases_halves` | eval `planted` | 14 | a whip easing each half in and out |
| `shake_fresh_per_frame` | eval `planted` | 15 | a shake drawing a new random offset each frame |
| `shot_writes_roll_0` | eval `planted` | 16 | a shot that writes roll 0 whatever its `roll` |
| `pan_ignores_angle` | eval `planted` | 17 | a pan that turns right whatever its `angle` |
| `match_framer_ignores_match` | eval `planted` | 18 | the incoming shot framed by its keep at place [0.5, 0.5], ignoring `match` |
| `kick_fresh_per_frame` | eval `planted` | 19 | a kick drawing a fresh random offset each frame |

Each plant goes through the check the real program passes, and must fail it naming what the criterion says.

## Criteria to tests

Each test's name starts with the criterion's ID (`AC<n> #493.<sha8>`, as `scripts/proof-change.mjs` computes it).

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#493.0b1b1a95` | `log-zoom.test.ts` (2) | frames 0 to 240 of a linear log zoom from 1.3e7 m to 1.3e13 m: each ratio 10^(6/240) within 1e-9, both ends within 1e-9; the plant's first ratio over 4,000, failing naming `frame 1` |
| AC2 `#493.872906a8` | `seal.test.ts` (3) | `r1` has no scene3d and camera@1 is the core's; at each cue end the film block, every node result of shared modules and the snapshot's SHA-256 equal `full`'s, and the push moves the camera; the planted build answers `module_missing` naming scene3d and the comparison fails |
| AC3 `#493.f2d3692f` | `follow-forward.test.ts` (1) | 10,000 seeded times: the camera's x never decreases while the walker steps back, it moves forward; the times in another order and 200 alone read the same bits (fails a raw follow, a smoothing by frame history) |
| AC4 `#493.07d4fcd4` | `overlap.test.ts` (2) | overlapping shots on one camera and on two refused naming both; adjacent shots joined by a cross-fade, and by a cut across cameras, accepted |
| AC5 `#493.d8794d67` | `transitions.test.ts` (1) | each of 60 frames of a cross-fade from an agx shot to an untoned one within one code value of (1 − p)·A + p·B of the sides rendered alone; the two looks draw apart (fails one tone map over the blend, a blend before the finish, looks ignored) |
| AC6 `#493.7831f8ec` | `transitions.test.ts` (1) | each of 60 frames: one status mark for the chip, at the outgoing side's bounds before 2 s and the incoming side's from 2 s, fail's exact color, 60% of its pixels exact, and only ground where the other side holds it (fails a blended or doubled chip) |
| AC7 `#493.5bfe22ba` | `defaults.test.ts` (4) | push 1.15 D → D on the framed aim; orbit −15° → +15° at D; a 0.5 s glide starting on the previous last pose within 1e-6 m and 1e-6 rad and on its own by 0.5 s; a channel on `items/cam/params/target/0` refused naming `nudge-x` and `held-shot`, accepted and writing when `keyed` |
| AC8 `#493.55016885` | `transitions.test.ts` (1) | at 2 s, every pixel of a 1920 × 1080 frame is exactly the incoming side where x < 960 (angle 0) and where y < 540 (angle 90), and exactly the outgoing elsewhere |
| AC9 `#493.b76c663b` | `reduced-motion.test.ts` (5) | under reduced motion: start pose before 2 s, framed pose from 2 s, a dissolve between them inside (1.9 s, 2.1 s) and none outside [1.85 s, 2.15 s]; the shaken camera equals the unshaken; the parallax offset constant; every glyph at its landed position with opacity changing; essential plays as without reduced motion. Each with a control without reduced motion |
| AC10 `#493.0704e790` | `framing-bound.test.ts` (2) | the union holds y [−1.1, 1.1] and is at most 1% taller; the box inside the safe frame at every 60 fps frame and at y = 1 at 1/60 s; the 30 Hz plant's union is [−0.1, 0.1] and the check fails naming `bob` and frame 1 |
| AC11 `#493.219170de` | `interval.test.ts` (5) | exp and sin over [1, 1] hold e and sin(1) strictly inside, against 40 digits in integer arithmetic; inari's 58 cases enclosed within 1e-12; the nearest-rounding plant returns one double each and fails naming both; the 1/(t − 1.01) box refused naming `spike` with a span around 1.01 s; the sample-fitting plant frames it from finite samples and fails the refusal check |
| AC12 `#493.c0595506` | `place.test.ts` (1) | four framings (perspective default and [0.3, 0.6] under `safe: 60`, two boxes at [0.65, 0.4], a 2D page at [0.25, 0.7]): the kept center within 0.5 px of the place on the safe frame at every frame |
| AC13 `#493.d82a99aa` | `lens-zoom.test.ts` (3) | position bit for bit; √3.625 at 1.45 s within 1e-6; post and ridge scale by the kept ratio within 1e-9; the degrees plant reads ≈ 1.6625 and fails, the dolly plant scales the ridge less and fails, each naming `shot zoom` |
| AC14 `#493.e7031693` | `whip.test.ts` (2) | the closed-form yaw within 1e-9° at every frame of the window and at the flick before the swap (6.5°, 26°, −26°, −6.5°, 0°), pitch and position held, 130°/s at the swap within 1°/s, 8 sub-samples at the swap from both sides; the plant fails naming `transition whip` |
| AC15 `#493.44160e6c` | `shake.test.ts` (4) | 10,000 times: position held, aim within 1.6° and roll within 1.6° of the push, both moved; one pose at 24, 60, 144 fps and by seek; the same ID in two documents equal, two IDs differ; the plant fails naming `shot jolt` |
| AC16 `#493.54b680f8` | `roll.test.ts` (3) | the horizon at 21° within 0.01° at every push frame, distance 4.6 → 4.0; the glide's roll from 21° down to 0° by 2.8 s, never off the short way; the plant fails naming `shot dutch` |
| AC17 `#493.f3a08e63` | `pan-tilt.test.ts` (2) | pitch −3° → 21°, azimuth and position held within 1e-9; the plant starts 24° off and fails naming `shot tilt` |
| AC18 `#493.e1213b8a` | `match-cut.test.ts` (2) | the ball at (1387, 376) px with radius ≈ 61; the sun's centre within 0.5 px and radius within 1% on the incoming first frame; the plant misses by over 450 px and fails naming `transition cut1` |
| AC19 `#493.55c15e8b` | `kick.test.ts` (5) | whole target pixels, ≤ 2, nonzero inside [1, 1.18) s, zero outside; equal at 24, 60, 144 fps and by seek; two kicks' sum ≤ 2; zero under reduced motion; the plant fails naming `camera cam` |
| AC20 `#493.b09e45f7` | `taste.test.ts` (1) | reads the record only; no pictures or no call is INCONCLUSIVE, never PASS (The taste call) |

## Choices where the issue is open

1. **Surfaces.** Poses, framing and refusals through `deep-motion eval`; sealing, pictures and the film's evaluated data
   through `deep-show run`. No new binary or subcommand; the new outputs are listed above.
2. **The pose a frame reports** is the one the camera is drawn through at t (Pose, above), with the kick applied.
3. **After a shot ends** and before another starts, the camera holds the pose the shot ended on, so a shot's end flick
   reads its move at u = 1 (AC1's frame 240, AC7's and AC17's ends).
4. **The log zoom's start** is `by` × the framed view width (the design's other start, "or from by times the framed view
   width"), with an explicit framed pose (`target`, `view_width: 1.3e13`), so its ends are exact.
5. **"Framed by keep at 4.000 m / 8 m".** The tests don't pin the keep fit's distance D; they read it (`shots.<id>.framed`
   and a hold shot of the same keep, which must agree) and check 1.15 D and D (AC7), and ratios that hold for any D
   (AC13). The last 60 fps frame of a 2 s push sits 1/60 s before its end: within 5e-4 of D.
6. **Yaw, pitch and azimuth** are read from `position` and `target` as Pose says; a whip and a shake turn about the world's
   up. Shake's "never more than 1.6° in aim" is the angle between the two aims.
7. **Follow-forward's axis** is the document's x (the walker moves along x), its move written `{follow_forward: ID}`.
8. **Transitions** write their kind's fields under the kind's name (`wipe: {…}`, `whip: {…}`), `progress: "linear"`, and
   `align` left at center, so a 1 s transition about a cut at 2 s spans [1.5 s, 2.5 s) and a 0.8 s whip [1.6 s, 2.4 s).
   "Each side rendered alone" is the same film with only that shot; the blend is per 8-bit channel of the finished,
   display-referred sides (The order of one evaluation: transitions "blend the finished sides").
9. **The reveal** of a cross-fade is 2 s; the frame at the reveal draws the chip from the incoming side.
10. **The reduced-motion dissolve** is centred on the cut, [1.9 s, 2.1 s]; inside it `film.dissolve` blends `from` the
    start pose `to` the framed pose with a nondecreasing `mix`, outside [1.85 s, 2.15 s] it is null.
11. **A shot's look** names a look@1 asset of the document. The two looks are the base's shipped clean look with
    `tone_map: {agx: {white: 16.29, contrast: 1.25}}` and with `tone_map: "none"`.
12. **The motion blur** a frame averages is configured on the eval line's look as `motion_blur: {shutter_angle, samples}`
    and reported as `cameras.<id>.blur`.
13. **The kick's look** is the eval line's look@1 `{basis: {indexed: {size: [320, 180]}}}`; offsets are measured as the
    target's displacement against the same document without the kick, in target pixels (4 u on a 1280 u page).
14. **"The same at 24, 60 and 144 fps"** is the same flick in documents at those `frame_rate`s, at the times all three have
    a frame on (multiples of 1/12 s), bit for bit; the kick's rate checks use four kicks (1, 1.5, 2, 2.5 s) so a fresh
    random offset can't hide behind rounding to 0.
15. **The match cut's radius** is half the projected box's height; the ball and the sun are boxes.
16. **The 1/(t − 1.01) refusal** carries `span: [from, to]` flicks with from ≤ 1.01 s ≤ to, narrower than the shot.
17. **The planted build for AC2** is `r1,test-camera-in-scene3d`, so the film is refused in a build without scene3d.
18. **AC9's film** is 2D: a push there changes the view width, a parallax group's offset is constant once drift holds, and
    the shake's offset is read as the shaken camera's pose equalling the unshaken one's.

## Criteria out of reach

- **AC20's "taken by the check run from the canvas's own frames" and "attached to the PR and shown to you".**
  `taste.test.ts` reads what is recorded and can't see how a picture was made or where it was shown. It holds
  INCONCLUSIVE until the record exists.
- Nothing else: every functional criterion has a test that reads its observation.

## The taste call

The check run writes six files to `docs/evidence/493/`: `push.png`, `orbit.png`, `cut.png`, `log-zoom.png` and
`cross-fade.png` (screenshots from the canvas's own frames) and `shot-list.apng` (a recording of the shot list: push,
orbit, cut, log zoom, a glide into a stage's shot). The owner's one call goes in `tests/acceptance/493/TASTE.json`, as in
#492:

```json
{ "issue": 493, "criterion": "#493.b09e45f7", "verdict": "looks_right", "who": "…", "when": "2026-11-08T09:00:00Z",
  "screenshots": { "push.png": "<sha256>", "…": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all six with their SHA-256. No test judges a picture.

## What the base already does and these tests don't credit

`deep-motion eval` reads `shots` only as stages name them, `hold` with a `target`, and reports `cameras.<id>.target` and
nothing else of a pose; it ignores a shot no stage names, refuses every transition but a cut between placements, and
has no `project`, `shots`, `blur` or this suite's plants. `deep-show` presents a 2D film and draws its canonical Vello
CPU snapshot, but its `eval` has no `film` block, shots don't move its camera, and it has no `test-camera-in-scene3d`
feature. The text module already keeps only an animator's opacity under reduced motion. The closed function list's
`fn` already bounds exp and sin outward over [1, 1] (#490).

So at the base 47 of 50 tests fail (`BASE-FAILURE.txt`), each on an assertion in this suite: a missing pose field,
`projected`, `shots` or `film` block, a missing plant (`bad_input`), a refusal the base doesn't raise, a transition kind
it refuses, a shot whose pose it doesn't apply, or the plant build `test-camera-in-scene3d` that doesn't exist; AC20 fails
as INCONCLUSIVE. 3 pass, because the issue also asks to keep what the base has right: AC2's precondition that `r1` seals
without scene3d with camera@1 in the core, and AC11's outward forms over [1, 1] and inari's cases (#490's forms). Each
sits beside a test that fails at the base: AC2's comparison and planted build, AC11's nearest-rounding plant.

## Scope not under a criterion

The issue's Scope and Fields also name: `pull`, `slam`, `follow(path)`, event shots, callouts and the overlay leader
(the 1.5 px elbow, `hide: off_frame`), `push {angle}` and `zoom_through {center}` transitions, `frame.avoid`, `zoom`,
reduced motion's `slow`, the transition `carry` and `align`, `item#bone` and `item#anchor` in keep, and a kick's `on:`
occurrence list. No criterion states an observation for them, so these tests don't check them; they are follow-ups for
the implementer's own tests.

## Upstream tests (the Oracle lane)

The Oracle page maps one criterion, 11, to inari `9e519ce47c`'s IEEE 1788 suite. Ported here (#136: a linked test
counts only when run against our output), with its Apache-2.0 notice kept in the receiving file
(`fixtures/itf1788-exp-sin.json`): every case of `minimal_exp_test` and `minimal_sin_test` in
`tests/itf1788_tests/libieeep1788_elem.rs` whose input ends are finite (12 exp, 46 sin), each run through `fn`'s `over`;
our forms must enclose the upstream (tight) result, each end within 1e-12 of it, an end past ±1e300 allowed to be
unbounded. The cases with an infinite input end are left out: JSON can't carry one.

`BASE-FAILURE.txt` is the run at the base.

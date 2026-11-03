# Acceptance tests for #418: canvas looks: the finish, with tone maps, ambient occlusion, deband, grade and bloom, and the look@1 kit

Written first, from issue #418 (its scope, its five field rows and their "It can never" lines, its eleven acceptance
criteria and its proof line: "Each tone curve against its analytic fixture, the finish at identity defaults, and the
AO, deband, grade and bloom fixtures read back on linear targets"), its parent #73, its dependencies #417, #185 and
#138 (titles and criteria), the design sections they link, and base commit `881e2ed4` ("Merge pull request #1136 …"),
by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Look (1306: "Tone mapping is none, filmic, AgX or neutral, the last two as analytic
  curves with no LUT asset. Ambient occlusion comes from a depth and normal prepass and darkens only ambient, probe
  and environment light in shading … it keeps no history. Physical looks deband by default … Status marks are drawn
  after tone mapping, so their color is exact"); Effect; GPU operator.
- `docs/canvas-primitives.md`: Look `look@1` (2411: `tone_map`, `exposure: EV100`, `finish: [effect]` "run as one
  shipped pass with identity defaults"), its tone mapping (2439), grade (2456: "a Bradford adaptation in linear
  light", "ASC CDL, after the tone curve", "The check applies the grade to every palette role a 3D writer layer uses
  and refuses one that moves a data color within the look's status distance wherever status can show"), bloom (2473:
  "a mip chain … mixed into scene color before tone mapping. With no threshold it conserves energy"; dirt "multiplied
  by 1 + intensity × d … the image stretched over the frame"; "`seeded` makes the image at check from the look's
  seed"), ao (2489) and deband (2505: "A triangular dither of deband_lsb steps from an integer hash of the pixel
  coordinate is added just before quantizing to 8 bits"); print finishes (2712, #464's); The status-color rule (68);
  Material (`alpha_mode`, `alpha`, `emission`, `emission_strength`), Object (`material`), Item (`adjust.opacity`),
  Light (`light.sun`), Sky `sky@1` (`ambient_top`, `ambient_low`); Canvas module: interface and implementation (1019).
- Issues #417, #185, #138 and #73 as GitHub holds them; #464 (print finishes: grain, vignette, print wear, the tone
  curve, the screen).
- At the base: AGENTS.md; `tests/acceptance/378/` (`view3d`, its targets and its tone reference), `380/` (bloom on
  the shipped glow, `from`, the look fixture), `382/` (the status report on `view3d`, `states`, the film, its helpers),
  `417/`, `185/` and its redraft (the plan's `interfaces`, the kit, release builds with a ledger), `138/`;
  `crates/deep-scene3d-render/src/output.wgsl` (none, filmic, agx, neutral at #378) and `scene3d.wgsl` (a sun lights
  over a fixed ambient quarter), `crates/deep-canvas-scene3d/src/look.rs` (`Look3`, `ToneMap`), `spec.rs` and
  `scene.rs` (`light.sun@1`, item-level `cast_shadow`), `crates/deep-effects-render/src/glow.rs` and
  `crates/deep-canvas-effects/src/shipped.rs` (the glow's mix `scene × (1 − intensity) + bloom ÷ levels ×
  intensity`), `crates/deep-gpu-layer/src/view3d.rs` (the call's fields, `assets`), `crates/deep-canvas-marks/src/
  modules.rs` (the `look` module implements `look@1`), `crates/deep-show/src/kit/manifest.rs` (the `look` category).

What the base already does and these tests don't credit: the output pass tone-maps by none, filmic, agx (contrast
and white read) and neutral; the glow mixes its mip chain into scene color by `intensity` with `radius`; `view3d` draws
#382's status marks and legend after the output pass; the plan publishes interfaces and the kit runs on `look`. There
is no `ao`, `deband`, `grade`, bloom `threshold`, `tint` or `dirt`, no `sky@1` or `material@1` kind, no `adjust` in 3D,
no `pre_tone` or `dirt` target, no `tone` call, no `dirt_overlay` plant and no `test-look-finish-off` feature. The
surfaces these tests read plainly don't exist at the base, so no base run was made (no `BASE-FAILURE.txt`); every
test that draws fails there on a refused or unread field, and `finish.test.ts` on its "off identity changes the
frame" checks.

## Run them

They build cargo binaries, so they run one file at a time. `scripts/lanes.mjs` needs this folder in its `alone`
list (the one-at-a-time unit-lane line), as #378's, #380's and #382's READMEs ask for theirs; this README is the
instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/418 --no-file-parallelism
npx tsc -p tests/acceptance/418/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each drawing file first runs `cargo build --locked --bin deep-gpu` (with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0`) once, copies the binary to a temporary folder, and fails each test if the build failed.
`kit.test.ts` builds `deep-show --no-default-features --features full,test-look-finish-off`, debug, and one
release build embedding a kit ledger, so it is slow. `tone.test.ts` also runs `git ls-files` in the checkout. Every
test writes into its own temporary folder and deletes it. Node built-ins and vitest only. A run with `--root
tests/acceptance/418` leaves Vitest's cache in `tests/acceptance/418/node_modules/.vite`; delete it.

The drawing tests run the GPU layer on Metal, on macOS, headless, as #378's, #380's and #382's do: off macOS, and
wherever the binary answers `unsupported_platform`, they fail with a message that starts `INCONCLUSIVE:`; they never
pass there. No criterion here has a time budget, so nothing is gated on the reference Mac, power or load.

## The surface under test

The issue names fields, fixtures and one planted implementation, but no code API. These tests extend the two
binaries that exist, through JSON lines as the earlier suites do, and add no binary: **#377's `deep-gpu run`** with
#378's `view3d` call (plus #380's and #382's fields) and **one new call, `tone`**; and **#185's `deep-show run`** with
#138's `kit` and one new test feature. Field names the design gives are used as it gives them; the rest are this
suite's choices, marked **bold**.

| Criterion | Call | Input this suite sends | What it reads back |
|---|---|---|---|
| `4d39a1c0` AO keeps direct light, darkens an ambient corner | `view3d` | `room(…, "direct" \| "ambient")`; look `ao: none \| {radius 0.5, strength 1, samples 8, resolution half, multi_bounce true, specular true}`; `targets: ["linear", "ids"]`, `capture: [0]` | `frames[0].linear` (f32), `.ids`, `.picks` |
| `e08a1aeb` deband | `view3d` | `ball(…)` (badge bound), look `exposure` (scale 0.1), `deband: none \| spatial`, `deband_lsb: 1`; `states: {verdict: fail}`; `targets: ["final", "linear", "ids"]` | `final` (PNG), `linear`, `ids`, `status.marks`, `status.legend` |
| `186ac2bb` finish at identity | `view3d` | `film(…)`; look plus `grade` at its defaults, `deband: spatial, deband_lsb: 0`, a grade off identity, deband at 1; `targets: ["final", "linear"]` | `pixel_hash`, `final`, `linear` |
| `186ac2bb` (scope) the look@1 kit | `deep-show run` | `{"call": "schedule"}`; `{"call": "kit", "sequences": 100, "param_sets": 50, "modules"?: ["look"], "ledger"?}`; builds `full` and `full,`**`test-look-finish-off`**; a release build with `DEEP_KIT_LEDGER` | `interfaces["look@1"]`: `module`, `reference`, `kit`, `behavior`, `implementation.{name, equivalence, state}`; kit `modules[].{verdict, parts[].{part, cases[].fixture}, failures}` with a failure's `fixture` and `field`; the startup refusal's `interface` |
| `51b765f4` AgX and Neutral curves, no LUT | **`tone`** | `{"call": "tone", "tone_map": {"agx": {"white": 16.29, "contrast": c}} \| "neutral", "input": path, "size": [256, 8]}` | `output` (f32) |
| `fdc46ec6` see-through items write no AO depth | `view3d` | `wall(…, "none" \| "blend" \| "mask" \| "zero" \| "opaque")`; look `ao` on; `targets: ["linear", "ids"]` | `linear`, `ids` |
| `9a0b4a91` a still AO frame however reached | `view3d` | `room(…, "both", spin)`; `fps: 60`, `from: 90 \| 0 \| 30`, `frames: 1 \| 91 \| 61` | `frames[n].pixel_hash` |
| `4c61160e` status exact under each tone map | `view3d` | `film(…, binding)`; look `tone_map: none \| filmic \| {agx} \| neutral`, `exposure` (scale 4); `states`; `targets: ["final"]` | `final`, `status`, `pixel_hash` |
| `5b97c661` grade refused near status; status, legend, 2D marks ungraded | `view3d` | `film(…, binding?, marker)`; look `grade: {white_balance, slope, offset, power, saturation}`; `window: {size, view, page}` | the refusal `{code: "status_distance", role}`; `final`, `window` (PNG), `ids`, `status` |
| `87688852` bloom conserves energy | `view3d` | `dot(…)`; look `bloom: none \| {intensity 0.04, radius 0.85}`; `targets: ["final", "pre_tone"]` | **`pre_tone`** (f32) |
| `052c8008` each curve's properties | **`tone`** | `tone_map: none \| filmic \| {agx} \| neutral`, `input` a grey ramp, `size: [2048, 2]` | `output` |
| `ecfba785` lens dirt | `view3d` | `dot(…)` and the black `dot(…, false)`; look `bloom: {…, dirt: {texture: sha256 \| "seeded", intensity: 2}}`, `seed`; `assets: {sha256: path}`; `targets: [… "pre_tone", "dirt"]`; `--planted`**`dirt_overlay`** | `pre_tone`, `final`, **`dirt`** (f32 hash) |

### `deep-gpu run [--planted <name>]`

#377's protocol holds unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered with exactly
one line `{"ok": true, "replies": [Reply]}`, one reply per call whatever its outcome, then exit 0; files written under
`out` are named by the SHA-256 of their bytes with their extension (`.png`, `.f32`). A reply with a `code` is a
refusal, except `unsupported_platform` off the reference platform.

### `view3d`: what this issue adds

```json
{"call": "view3d", …#378's, #380's and #382's fields…,
 "targets"?: ["final" | "linear" | "ids" | "pre_tone" | "dirt"], "assets"?: {"<sha256>": path}}
```

- **`targets: "pre_tone"`**: the linear image the tone-mapping pass reads, after the effects chain and bloom, before
  exposure: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, as `linear` is (#378). With `bloom: none` it
  equals `linear`.
- **`targets: "dirt"`**: the lens dirt image `d` (0 to 1) as the last upsample reads it at each pixel of the frame,
  f32 RGBA with `d` in red, green and blue; written only when the look's bloom has `dirt`.
- `assets` (#420's map from sha256 to a file) also resolves a dirt `texture`: a PNG, its value `d` the red channel ÷
  255, stretched over the frame.
- The look (a `look@1` object, as #378's) takes the issue's fields: `tone_map: "none" | "filmic" | {"agx": {"white",
  "contrast"}} | "neutral"`; `ao: "none" | {radius, strength, samples, resolution, multi_bounce, specular}`;
  `deband: "none" | "spatial"`, `deband_lsb`; `grade: {white_balance: {temperature, tint}, slope, offset, power,
  saturation}`; `bloom: "none" | {intensity, radius, threshold?, tint?, dirt?: {texture: sha256 | "seeded",
  intensity}}`; and **`seed`** (an integer), the look's seed seeded dirt is made from.
- Documents take, beside #378's, #380's and #382's kinds: **`sky@1`** with `ambient_top` and `ambient_low` (linear
  RGB), the scene's ambient light (a scene with a sky whose ambient is 0 has none; the base's fixed ambient quarter
  is for scenes with no sky, which these tests don't read); **`material@1`** items (`base_color: color | {role}`,
  `alpha_mode: opaque | mask | blend | add`, `alpha`, `emission: linear RGB`, `emission_strength`) named by an
  object's item-level **`material`** (Object: `material: material ID`, as `cast_shadow` is item-level at the base);
  and an item's `adjust: {opacity}` in 3D (Object: "With opacity below 1 it draws see-through").

### `tone` (new)

```json
{"call": "tone", "tone_map": "none" | "filmic" | {"agx": {"white": f32, "contrast": f32}} | "neutral",
 "input": path, "size": [w, h]}
→ {"output": sha256}
```

Runs the tone map, as the frame's tone-mapping pass runs it, on this machine's GPU over every pixel of `input` (an
f32 RGBA file, the layout above), with no exposure, and writes what it gives before the sRGB encode as `<out>/<sha256>.f32`
of the same size; alpha passes through. It is the issue's "analytic fixture" surface: each curve read at as many
inputs as a test needs.

### Planted program (`deep-gpu run --planted dirt_overlay`, reachable only there)

**`dirt_overlay`**: the dirt image is laid over the frame as an overlay (`intensity × d` added to every pixel)
instead of multiplying the light bloom mixes in. Criterion `ecfba785` names it.

### The look@1 kit (`deep-show`)

**`test-look-finish-off`**, a test feature of `deep-show` in no shipped build: the look module's implementation
replaced by a planted one (its own name, `equivalence: bit`, `state: canonical`) whose finish pass at identity
defaults changes one pixel of one fixture's frame. Everything else is #185's and #138's: the plan's
`interfaces["look@1"]`, the `kit` call with `modules` and `ledger`, the release build's seal reading
`DEEP_KIT_LEDGER`, and its `seal_refused` line with `interface`.

## Documents and the look (`helpers.ts`)

Every document is generated in `helpers.ts`, one writer layer `main` (writer `agent-a`), `requires: {modules:
{scene3d: "^1", effects: "^1"}}`, items `family.name@major`. The look is #382's: the clean status map, one glyph per
state, `min_distance` 0.10, an automatic legend, `basis: physical`, a #101114 ground, tone map none at the exposure
whose scale is 1 (EV100 −log₂ 1.2), `finish: []`, `deband: none`, `bloom: none`, `ao: none`, no ground grid; tests
change only the fields named.

| Document | What it is | Criteria |
|---|---|---|
| `film` | #382's film: three boxes on a floor under a sun along −Z, seen from +Z, 480 × 360; with `binding` the lamp's badge is bound to a verdict; with `marker` a 2D writer layer's dot (role `marker`) is anchored to the lamp through `overlay.frame@1` (#378) | `186ac2bb`, `4c61160e`, `5b97c661` |
| `room` | 640 × 480: a floor, a wall (front face at z = −1.9) and a card standing 0.28 m in front of it; `direct`: a sun along (0, −0.5, −0.87) and a sky with no ambient; `ambient`: the sky's ambient 0.6 alone; `both`; `spin` turns the camera −30° → 0° over the first second | `4d39a1c0`, `9a0b4a91` |
| `wall` | 480 × 360: a wall lit by the sky's ambient alone, and a 1.2 m card 0.15 m in front of it: none, opaque (the twin), `material` with `alpha_mode: blend, alpha: 0`, with `alpha_mode: mask, alpha: 0`, or `adjust.opacity: 0` | `fdc46ec6` |
| `ball` | 512 × 512, orthographic (128 px per m): a 3 m sphere lit from the front, its badge bound to the verdict | `e08a1aeb` |
| `dot` | 512 × 512, orthographic (51.2 px per m): a 0.12 m sphere (about 6 px) at the centre, `material` emission 20, on black (#000000 ground), a sky with no ambient, no sun; or the black frame alone | `87688852`, `ecfba785` |

## The references (reviewed test code, f64)

- **AgX**: the issue's curve exactly: below 0.18, x^c ÷ (x^c + a), a = (1 ÷ 0.18 − 1) × 0.18^c; above it, 0.18 +
  k·d·(1 + d ÷ w) ÷ (1 + k·d ÷ 0.82), d = x − 0.18, k = a·c·0.18^(c−1) ÷ (0.18^c + a)² (the toe's slope at 0.18), w =
  k(white − 0.18)² ÷ 0.82; 1 at and above white; 0 at and below 0. Per channel between the AgX inset and outset
  matrices as three.js and Filament publish them (`AgXInsetMatrix`, `AgXOutsetMatrix`, column-major), applied to the
  look's linear RGB directly (the issue names no Rec. 2020 conversion), then clamped to [0, 1].
- **Neutral**: Khronos PBR Neutral's reference (start compression 0.8 − 0.04, desaturation 0.15), clamped to [0, 1].
- **Filmic**: the ACES fit Narkowicz published, x(2.51x + 0.03) ÷ (x(2.43x + 0.59) + 0.14), clamped (#378's reading).
- **None**: clamp to [0, 1].
- **Each curve's white** (criterion `052c8008`): none 1; filmic 7.24166, where its fit reaches 1; AgX its `white`;
  Neutral reaches 1 only in the limit, so its white is the grey where it comes within half a 10-bit code value of 1
  (118.4), and above it the output must be within that half code of 1.
- **10-bit code values**: both sides sRGB-encoded, × 1023.
- **The ASC CDL**: (clamp(in × slope + offset))^power, then saturation about Rec. 709 luma, on display-linear values
  after the tone curve (under tone map none, the clamped linear value).
- **OKLab**: Ottosson's published matrices; status distance 0.10.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#305's command, over the live issue's eleven criterion lines). Each test's name starts with
its criterion's ID.

| ID | Criterion | Test (file) and what fails it |
|---|---|---|
| `#418.4d39a1c0` | With ambient occlusion on, a card lit only by a direct light keeps its radiance within 0.5% of the same frame with it off, while an ambient-lit corner darkens | `ao.test.ts`: in the direct room, every card pixel (and every floor and wall pixel) keeps its linear radiance within 0.5% per channel with ao on; the card is lit (mean luminance > 0.02); in the ambient room, the floor pixels within 4 px below the wall darken to 0.95 or less of their mean with ao off. Wrong programs: AO that scales direct light; AO that does nothing |
| `#418.e08a1aeb` | Deband changes no pixel by more than 2 code values, keeps each 16 × 16 block's mean within 0.25 of a code value of the smooth gradient, and leaves status colors exact | `deband.test.ts`: on the dark ball, no pixel more than 2 code values from the undithered frame, more than 1% of ball pixels changed; every 16 × 16 block wholly on the ball and off status (at least 50) within 0.25 of the smooth gradient's mean; the twin (no deband) misses it in at least one block; the fail mark and legend exact, and the mark's pixels the undithered frame's. Wrong programs: no deband; a wider dither; a deband over status |
| `#418.186ac2bb` | The finish pass with every built-in effect at its identity default changes no pixel | `finish.test.ts`: the grade at its defaults, with deband absent or at amplitude 0, has the identity finish's pixel hash; that frame is the sRGB encoding of its linear target, rounded (exactly away from ties); a grade off identity and deband at 1 each change the frame. `kit.test.ts` (scope): the planted `test-look-finish-off` declares bit, fails the kit with a failure naming a fixture the kit ran and a `field`, and its release build refuses it naming `look@1`. Wrong programs: a white balance at 6500 K that isn't the identity; a finish that moves pixels; the planted implementation. The shipped side (look@1 names its implementation, bit and canonical, no behavior part, every #138 part, and the shipped look passes its kit on its own fixtures, which reach the finish) is the blind redraft `redraft/kit-shipped-redraft.test.ts`, swapped in with the owner's approval for this draft's first kit test (`redraft/DISPUTE.md`) |
| `#418.51b765f4` | AgX matches the curve the look defines (…) within one 10-bit code value at contrast 1.0, 1.25 and 1.5 with white 16.29; Neutral matches Khronos's reference within one; and the app ships no LUT file | `tone.test.ts`: 512 greys to 32.58 and 1,536 seeded colors to 16 through `tone`, every channel within one 10-bit code value of the f64 curve, for AgX at each contrast and for Neutral; the twin (contrast 1.0 against the 1.25 curve) misses; `git ls-files` outside tests and docs holds no LUT by extension or name, and the scan finds a planted `.cube` and a named LUT. Wrong programs: a LUT; a curve that ignores contrast; another neutral |
| `#418.fdc46ec6` | Alpha-blended, masked-sprite and zero-opacity items write no ambient-occlusion depth: an invisible glow sprite in front of a wall leaves the wall's ambient light within 0.5% of the same frame without the sprite | `ao.test.ts`: with each of the blend, mask and zero-opacity sprites, every wall pixel keeps its linear light within 0.5% of the bare wall's; the twin, an opaque card, darkens more than 50 visible wall pixels beyond 0.5%. Wrong program: a prepass that writes every item's depth |
| `#418.9a0b4a91` | A still frame with ambient occlusion is the same however it was reached, on the same machine's pixel hash | `ao.test.ts`: frame 90 seeked, played from 0 and played from 30 has one pixel hash; frame 30 differs (the camera turned); ao none differs. Wrong program: AO with history |
| `#418.4c61160e` | Each tone map (none, filmic, AgX, neutral) renders the fixture scene with the status colors still exact | `tone.test.ts`: the bound film, 2 stops over, under each: the fail mark's color and its most common pixel, and the legend's fail swatch, are #bf232b exactly; four distinct pixel hashes. Wrong program: status drawn before tone mapping |
| `#418.5b97c661` | Wherever status can show, a grade that would move any palette role a 3D writer layer uses within the look's status distance is refused naming the role, and status colors, legends and 2D marks are never graded | `grade.test.ts`: with the binding, the grade taking the lamp onto fail is refused `status_distance` naming a role it moves within 0.10; played alone it's accepted; an accepted grade leaves the fail mark, legend and the 2D marker's color exact while grading the lamp's face to this suite's CDL within one code value. Wrong programs: no check; a check of ungraded roles; a grade over status or the 2D layer |
| `#418.87688852` | With no threshold, bloom conserves energy: the frame's summed linear luminance changes by under 1% | `bloom.test.ts`: `pre_tone`'s summed luminance with bloom within 1% of bloom none's; bloom raises the light 20 px out. Wrong program: an additive bloom |
| `#418.052c8008` | Each tone curve (none, filmic, AgX, neutral) keeps black at black and neutral greys neutral, never decreases, maps [0, white] into [0, 1] and is clamped to 1 above white, checked by an analytic parity fixture | `tone.test.ts`: through `tone`, 2,048 greys from 0 to twice white and 2,048 from white to 64 × white per curve: 0 → exactly 0, channels within 1e-4, no decrease beyond 1e-6, [0, white] inside [0, 1], 1 above white (within 1e-6; Neutral within half a 10-bit code); the twin (the ACES fit unclamped) fails. Wrong programs: an unclamped curve; a curve that tints greys |
| `#418.ecfba785` | Lens dirt shows only where bloom is: (…) a planted dirt laid over the frame as an overlay brightens the black frame and fails, naming the pixel | `bloom.test.ts`: the light bloom adds at (236, 255–256) is 3× the clean bloom's within 1%, and at (275, 255–256) equal within 1%; the black frame's `pre_tone` is exactly 0 and its final black; seeded dirt (seed 418) has one `dirt` hash in two processes, seed 419 another, and isn't flat; `--planted dirt_overlay` fails the black-frame check, naming a pixel |

## Readings where the issue is silent

- **"Every built-in effect at its identity default"** is the grade at the issue's field defaults (white balance 6500 K
  and tint 0, slope 1, offset 0, power 1, saturation 1) and deband present at amplitude 0 or absent: the finish
  effects this issue builds. Grain, vignette, print wear, the tone curve and the screen are #464's; when they land,
  their identity joins this fixture by a redraft. 6500 K must be the identity, as the issue gives it as the default.
- **The finish test can't fail on the base by its equalities alone** (the base ignores `grade`), so it also asserts a
  grade off identity and deband at 1 change the frame.
- **The kit's plant is the scope's**, not a criterion's; it is tested beside `186ac2bb`, whose behavior it seals. "Every
  part of the canvas kit" is read as: look@1's `kit` holds every part any interface in the plan lists (behavior parts
  aside), and the kit runs exactly those parts on the look module, on fixtures under `parity/look/`.
- **10-bit code values** are compared after the sRGB encode, × 1023, per channel.
- **AgX's matrices** apply to linear RGB directly, as the issue's text and the base's output pass do; no Rec. 2020
  conversion.
- **Ambient light** comes from a `sky@1`'s `ambient_top` and `ambient_low` (the design's only ambient source), so "a
  card lit only by a direct light" is a room under a sun with a sky whose ambient is 0. The corner that darkens is the
  floor within 4 px below the wall in the ambient room; "darkens" is read as its mean luminance at 0.95 or less of
  ao off's.
- **"An invisible glow sprite"** is a card whose material is `alpha_mode: blend, alpha: 0`, `alpha_mode: mask, alpha:
  0`, or whose `adjust.opacity` is 0: the criterion's three kinds, each invisible, compared with the bare wall. The
  twin that shows the check sees occlusion depth is the same card opaque, compared on the wall pixels it leaves visible.
- **"The same however it was reached"** is three routes to frame 90 (seek, play through the camera's turn, play from
  mid-turn), all in one process each call, compared by pixel hash.
- **The smooth gradient** is the f64 sRGB encoding of the linear target, unquantized, × 255; blocks are aligned to the
  16 px grid and wholly on the ball and off status (grown 2 px).
- **"The light bloom adds"** is `pre_tone` with bloom on less `pre_tone` with `bloom: none`, as Rec. 709 luminance;
  "20 pixels away" is the pixels whose centres sit 19.5 px left and right of the frame's centre on its two middle rows.
  The dirt image is the frame's size, so its texels land on the frame's pixels.
- **The look's seed** for seeded dirt is a top-level `seed` on the look (the design says "from the look's seed" and
  lists no field); "by hash" is the `dirt` target's file hash.
- **The grade's refusal** is the look's existing `status_distance` refusal (#382's), naming `role`; the test accepts any
  3D layer role its own CDL moves within 0.10 of a status color (the lamp among them). "2D marks" are a 2D writer
  layer's items drawn over the view in the window (#378); legends and status marks are #382's.
- **Energy** is read on `pre_tone` with bloom's defaults (intensity 0.04, radius 0.85) and no threshold.

Not tested, because no criterion asks: bloom's `threshold` and `tint`; AO's `samples: 16`, `resolution: full`,
`specular`; white balance off 6500 K; keying the grade per shot; the physical looks' default tone maps through
studio@1's looks; the "It can never" rows about budgets and earlier frames, beyond what the criteria above read.

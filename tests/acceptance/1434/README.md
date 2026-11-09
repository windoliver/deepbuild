# Acceptance tests for #1434: chrome layers, group opacity, a backdrop read and effect slots in paint order

Written first, blind, from issue #1434 (Scope, Fields, its eight acceptance criteria, Proof, Depends on), the design and
the base commit `dd83ac2f`, by a job that never saw an implementation; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read: `AGENTS.md`; `docs/technical-design.md` (Panels and devices, States people see, Replica, Numbers version 0
has to hold, Every task carries its own budgets, the reference Macs); `docs/canvas-primitives.md` (GPU surface, whose
paragraph already names the three primitives; Effect and the shipped operators; Question card; Frame clock and scheduler;
Meter and degrade ladder); at the base `vendor/gpui-pre` (Scene, `paint_surface`, the headless app context),
`vendor/gpui-pre-apple` (`metal_renderer.rs`, the quad shader's `quad_sdf` and its `saturate(0.5 - sdf)` coverage, the
planted twins in `gpu_surfaces.rs`, `upstream/README.md`'s carried-patch table), `crates/deep-app` (`main.rs`'s
`--color-check`, the `env-plants` feature and its release refusal), `crates/deep-replica` (`main.rs`, its features),
`crates/deep-canvas-effects/src/shipped.rs`, `crates/deep-gpu-layer` (`deep-gpu` and its `--planted` list),
`crates/deep-marks-render/src/macos.rs` (the idle run's frames and package-idle wakeups), `scripts/benchmark.mjs`
(`fingerprint`, `judgeLimit`), `scripts/lanes.mjs`, and the suites `tests/acceptance/377`, `140/gpu`, `391` (its PNG
reader, reused by import), `1426`, `1427`.

## Run them

```sh
npm ci                                        # once
npx tsc -p tests/acceptance/1434/tsconfig.json
npx vitest run --root tests/acceptance/1434 --no-file-parallelism            # ac1-ac5's headless half
# by hand on the reference Mac, the live window on this Mac's screen (never in CI):
DEEP_1434_LIVE=1 npx vitest run --root tests/acceptance/1434 --no-file-parallelism ac5 ac6 ac7 ac8
```

macOS with Metal and cargo on `PATH`; anywhere else each test fails `INCONCLUSIVE:` and never passes. Files build once
before their tests and copy the binary out of `target/`:

- `cargo build --locked -p deep-replica --bin deep-replica --features chrome-fixture` (ac1-ac4, ac8);
- `cargo build --locked --release -p deep-app --bin deep-app --features chrome-fixture` (ac6-ac8; release, since ac7
  times frames). The `*.live.test.ts` files build only with `DEEP_1434_LIVE=1`; without it each of their tests fails
  `INCONCLUSIVE`, as #140's live files do.

Lanes (the implementer edits `scripts/lanes.mjs`): `tests/acceptance/1434/` in `alone` (its files build cargo binaries,
and `ac5-unchanged.test.ts` runs #377's handoff suite); the three `*.live.test.ts` files in `byHand`;
`ac7-budgets.live.test.ts` in `timed`, the local preflight's perf step that sets `DEEP_1434_LIVE=1` on the reference Mac.
A run with `--root` leaves Vitest's cache in `tests/acceptance/1434/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is
the run at the base. No Cargo target is needed: the tests are TypeScript.

## The surface under test

The issue names fields (`layer: {opacity, radii, edge}`, `backdrop: {scale: 1 | 0.5 | 0.25}`, `effect: {operator,
params, place: under | over}`) and two places, the replica and the live window, but no binary or API. So the tests drive
the app's real chrome code through two existing binaries, each with one new mode behind one new Cargo feature,
`chrome-fixture`, which no shipped build has (the design: fixture code and plants stay out of the shipped binary). Unlike
`env-plants`, it builds in release, which ac7 needs. `deep-replica`'s `chrome-fixture` turns on `deep-app/chrome-fixture`.
How a fixture maps onto GPUI elements and the vendored renderer (method names on `Styled`, Scene primitives, a pass in
`metal_renderer.rs`) is the implementer's.

### The fixture, `chrome@1` (`fixtures/*.json`)

```jsonc
{
  "format": "chrome@1",
  "window": [w, h],            // points
  "scale": 1 | 2,              // the replica draws at it; the live window draws at its display's and reports it
  "background": [r, g, b],     // the window's opaque fill
  "nodes": [Node],             // in paint order, first painted first
  "card"?: {"ask", "question", "options": [{"id", "label"}], "rect": [x, y, w, h]}   // the shell's question card in its slot
}
Node = {
  "id": string,
  "rect": [x, y, w, h],        // points, window coordinates, children's too
  "fill"?: [r, g, b, a] | {"gradient": [[r, g, b], [r, g, b]]},   // 8-bit straight color, or a horizontal linear gradient
  "radius"?: pt,               // the node's corner radius: its fill's, and its effect slot's clip
  "text"?: {"content", "size": pt, "color": [r, g, b]},          // drawn from the rect's origin, the system font
  "layer"?: {"opacity": 0..1, "radii": [tl, tr, br, bl], "edge": pt},
  "backdrop"?: {"scale": 1 | 0.5 | 0.25},
  "effect"?: {"operator": "frost@1", "params": {...}, "place": "under" | "over"},
  "deferred"?: true,           // paints in GPUI's deferred pass, after the rest of the window, as a popover does
  "children"?: [Node]
}
```

A node paints: its effect slot if `place` is `under`, its fill, its text, its children, then its slot if `place` is
`over`. A `layer` draws the node's subtree offscreen and composites it once at `opacity`, clipped to `radii` with a soft
edge of `edge`. A `backdrop` is a copy of what the window holds under the node's rect when the node starts painting, at
that scale; the node's effect reads it. The card is drawn by the shell, as the app draws it, in its slot.

### The operator, `frost@1`

The one operator these tests use, shipped as a checked graph like #380's (no shader text in chrome or fixtures). Params:
`sigma` (device px, 0 to 32; 0 is no blur) and `tint` (premultiplied 8-bit RGBA, each color at most its alpha). Its
output over the node's rect, in the 8-bit values the window stores, over 255: a separable Gaussian of the backdrop with
weights exp(−k²/2σ²) for |k| ≤ ⌈3σ⌉, normalized, horizontal then vertical, sampling clamped to the backdrop's bounds;
then the tint over it, `tint + blur × (1 − tint.a)`. At backdrop scale 1 that is exactly `frostReference` in
`helpers.ts`, the CPU reference criterion 2 compares with. At 0.5 and 0.25 the backdrop is downsampled and σ applies at
its scale (used only in ac6 and ac8, which never compare with the reference).

The slot composites its output premultiplied (source factor one, destination one minus source alpha) under its clip:
GPUI's rounded-rect coverage, `saturate(0.5 − sdf)` at each pixel's center, the standard rounded-rect distance its quad
shader uses (`coverage` in `helpers.ts`). That is the reference for criterion 3's rounded corners.

### `deep-replica --chrome <fixture> --out <dir> [--omit-effect <id>]…`

The replica draws the fixture headless with GPUI's offscreen Metal renderer at the fixture's window and scale, writes
`<dir>/screens/chrome.png` (8-bit RGB or RGBA, device px) and `<dir>/chrome.json`, and exits 0. `--omit-effect <id>`
draws the window with that node's effect slot taken out, and nothing else changed. `chrome.json` is
`{"refusals": [Refusal]}` and any other field the implementer wants; a refusal is the app's record of an effect it
refused: `{"effect": node id, "operator": its operator, "over": "card" | "access_prompt", "code"}`.

### `deep-app --chrome <fixture> (--snapshot <png> | --idle <seconds> | --frames <n>)`

The app's real window on this Mac's screen, the fixture as its content, presenting through its `CAMetalLayer`, as
#140's `--color-check` opens it. It prints one report line, `{"chrome": 1434, "mode", "scale", …}` (`scale`, the
display's), then quits:

- `--snapshot <png>`: once the window has drawn and settled, reads back the drawable it presented (#140's read-back)
  and writes it as a PNG of the window in device px. `mode: "snapshot"`.
- `--idle <seconds>`: waits until every effect reports settled, then holds the window that long on the real clock.
  `mode: "idle"`, `effects: [{"id", "state": "settled" | …}]` (every node with an effect), `seconds` (the hold),
  `frames` (frames the window presented in the hold) and `wakeups` (the process's package-idle wakeups in the hold, as
  `deep-marks-render`'s idle run reads them from the kernel).
- `--frames <n>`: draws n frames back to back, the whole tree repainted each frame. `mode: "frames"`,
  `frames: [{"frame", "cpu_ms", "gpu_ms"}]`: the UI thread's time in that frame (layout, paint and the renderer's encode)
  and its command buffers' GPU time (the GPU ledger, #391).

### Planted programs (`DEEP_CHROME_PLANT=<name>`, read only in a `chrome-fixture` build)

| Name | The wrong program | Criterion |
|---|---|---|
| `multiplies_per_element` | A layer multiplies its opacity into each element's paint, as GPUI's opacity does, instead of compositing the group once | 1 (issue-named) |
| `straight_alpha_slot` | The effect slot's premultiplied output is blended as straight alpha (source factor source alpha), so translucent pixels are multiplied twice | 3 (issue-named) |
| `no_card_guard` | The guard that refuses an effect over the question card or an access prompt is off: the effect draws and nothing is refused | 4 |
| `redraws_settled_effects` | A settled effect asks for a frame every vsync and redraws | 6 |

Criterion 4's "planted effect over the question card" is input, not a wrong program: `card.json`'s `flare`. The first two
plants live in the vendored renderer, so their switch is a vendored hunk too (as `gpu_surfaces::plant` is #377's).

## Criteria to tests

| Criterion (the issue's text) | Test | How it is judged |
|---|---|---|
| 1. Two overlapping quads in a 50% layer: every pixel of the overlap equals the composite of the group. A planted renderer that multiplies per element fails, naming the pixel | `ac1-group-opacity.test.ts` | `group.json`: red then blue opaque quads in a layer at 0.5 over white. Every overlap pixel is (127.5, 127.5, 255) within one code value (the rounding of .5). `multiplies_per_element` fails the same check, its first finding naming an overlap pixel `pixel (x, y)` |
| 2. A frost effect over a gradient and text is within one code value of the CPU reference in the interior | `ac2-frost.test.ts` | `frost.json`: frost@1 (σ 4, tint 26) over a gradient and two lines of text. The backdrop is the window with the slot omitted; the reference is `frostReference` on it. Every pixel at least ⌈3σ⌉ + 1 from the node's edge within one code value; the reference must differ from the backdrop by at least 16 somewhere, so the fixture can fail |
| 3. A slot between two elements draws in order, with rounded corners within one code value of the reference. Translucent pixels aren't multiplied twice; a planted straight-alpha path fails | `ac3-slot-order.test.ts` | `slot.json`: grey, then a radius-24 slot (frost@1 over the uniform grey, so its output is exactly the tint over grey), then green over part of the slot. Every pixel of the grey node within one code value of: green where green is, else slot × coverage + grey × (1 − coverage). The 160 corner pixels with partial coverage are checked; `straight_alpha_slot` fails, a finding naming one of them |
| 4. A planted effect over the question card is refused, the card's pixels are byte-equal to its render with no effect, and the refusal names the effect and the card | `ac4-card.test.ts` | `card.json`: the card in its slot and `flare`, a deferred node whose dark frost covers it. A refusal `{effect: "flare", operator: "frost@1", over: "card"}`; the card's slot byte-equal to `--omit-effect flare`'s, which shows a drawn card and refuses nothing. `no_card_guard` refuses nothing and changes the card's pixels, so the comparison can see an effect over the card |
| 5. The #140 color check and the #377 handoff fixture still pass | `ac5-unchanged.test.ts` | Runs `tests/acceptance/377/handoff.test.ts` (all of `#377.756c6dce the surface handoff passes parity/gpu/surface-handoff.scene against the copy path on this machine`) and, live, `tests/acceptance/140/gpu/color.live.test.ts` (AC5, AC9, AC19) with `DEEP_140_LIVE=1`, unchanged, through Vitest's JSON reporter: every test passed, none failed, skipped or todo |
| 6. A window with 5 settled effects has 0 frames and at most 1 wakeup over 10 s | `ac6-idle.live.test.ts` | `idle.json` (five frost@1 slots at every backdrop scale, under and over, one inside a layer), five `--idle 10` runs: every effect settled, 0 frames in each, and the five wakeup counts judged by `judgeLimit` against 1. `redraws_settled_effects` presents frames |
| 7. Budgets, on the reference Mac in the local preflight, compared with the merge base: a 960,000 px layer adds under 1 ms a frame, and a backdrop read adds under 1.5 ms | `ac7-budgets.live.test.ts` | `budget-layer.json` and `budget-backdrop.json` (a 600 × 400 pt node, 960,000 px at scale 2) against their twins with the primitive taken out. Each run: 360 frames a side, the p95 of `cpu_ms + gpu_ms` over the last 300; the added time is the difference. A warm-up pair, then five runs alternating which side goes first, judged by `judgeLimit` (limit 1 and 1.5 ms) |
| 8. Replica and live snapshots are equal for a fixture using all three primitives | `ac8-snapshots.live.test.ts` | `all.json` (a layer with radii and a soft edge, a half-scale backdrop read by frost@1 under its node's text, an element after them) at scale 2: the replica's PNG and the live window's presented drawable, equal at every pixel |

Budgets and wakeups go through `scripts/benchmark.mjs`'s `judgeLimit` with the load at each run's start and end: PASS
only on a reference Mac (Mac15,7, Mac15,12 or Mac17,10) on mains power, Low Power Mode off, the thermal state nominal and
the load under the core count, with all five runs within the limit; FAIL when all five are over by more than the margin;
otherwise INCONCLUSIVE, which fails the test and never passes it. A live window off scale 2 is INCONCLUSIVE for ac7 and
ac8 too: the fixtures make 960,000 px, and the replica's scale, only at 2.

## Readings where the issue and design leave a choice

- **"The composite of the group"** is the premultiplied over in the 8-bit values the window stores, as GPUI blends:
  the overlap is opaque blue inside the layer, so 0.5 × blue + 0.5 × white. One code value of tolerance is for 127.5.
- **"The CPU reference"** for the frost is frost@1's definition above run by the test on the window's own backdrop, so a
  GPU frost that matches only its own CPU port can't pass. The interior keeps clamping at the backdrop's edge out.
- **"Rounded corners within one code value of the reference"**: the reference coverage is GPUI's own quad coverage, so a
  slot clipped like any rounded GPUI element passes. A soft `edge` isn't judged by a reference (no criterion asks); it is
  in ac6's and ac8's fixtures.
- **"Translucent pixels"** are the slot's partly covered corner pixels; the slot's output is opaque, so only there do
  the premultiplied and straight paths differ, by up to about 52 code values.
- **"A planted effect over the question card"** reaches over the card only from a node painted after it: a deferred
  node. "Refused and recorded" is read on `chrome.json`'s `refusals`, the app's record of it.
- **The idle window** is the live one: only a shown window has a display link to wake it. "Settled" is every effect
  reporting `settled` before the hold starts. Wakeups are package-idle wakeups, as #854's canvas-idle reads them; the
  Metal driver's interrupt wakeups aren't counted. "Over 10 s" is read on each of five runs.
- **"Compared with the merge base"**: the merge base has no chrome layers, so its frame for these fixtures is the same
  content with the primitive taken out, which is what that renderer draws; what a primitive adds is the p95 difference.
  The design's merge-base regression check of whole budgets (20 samples a side, p50) stays the perf lane's. "A backdrop
  read" is a 960,000 px backdrop at scale 1 read by frost@1 at σ 0 with a light tint, so the copy can't be skipped as
  unread; the slot's own pass is in the number.
- **Live and replica snapshots** are pixel images, not text snapshots: the primitives change pixels only. "Equal" is
  every pixel of the window in device px.

Not tested, because no criterion leans on it: an effect drawing outside its element or panel; an effect over an access
prompt; an off-screen effect; an effect past its budget holding its still pose; refusal of shader text in chrome; half-
and quarter-scale backdrops against a reference. The carried-patch rows (Scope's last line) are enforced by
`node scripts/vendor-rebase.mjs check` in the lint lane: each vendored change for this issue needs a row in
`vendor/gpui-pre-apple/upstream/README.md`, whose Test column can name tests here (ac1's and ac3's planted tests see the
renderer's own change).

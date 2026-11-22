# #2288 evidence: each: over a moved, turned or scattered instancer

Recorded on 2026-11-22 on this Mac, on the PR's head 02ebe24a4 (the change merged with main 5fcfb690b). Every scene is
the blind suite's own fixture (`tests/acceptance/2288/helpers.ts`), with display-only items added: a floor plate, a sun
and a fill light, and two `material@1` items. None of these is a physics body. The pictures are `deep-gpu`'s `view3d`
frames at 640 × 360. No test reads them; the numbers below come from the same runs.

## Pictures and clips

| File | Panels, left to right |
|---|---|
| `turned.mp4` (2 s at 60 fps, played at half speed), `turned-f000.png`, `turned-f060.png`, `turned-f120.png` | **1. This change.** `view3d` bakes the world itself, writes `tile#*` into the columns of `tiles` (at (5, 0, 0), turned 90° about +Y) and draws the instancer: instancer × row. **2. Truth.** Each body drawn straight at its baked world pose (an instancer at the origin, unturned, its rows the bake's poses). **3. A wrong program.** The same world poses written into the turned instancer's columns without the inverse, so they're moved and turned twice. |
| `scatter-t0.png` | **1.** The scatter as the scene module draws it (`from: distribute(…)` on the plate 2 m up). **2.** The 200 bodies as `each:` built them (bake index 0). |
| `scatter.mp4` (5 s at 30 fps), `scatter-f045.png` | **1.** The `each:` world's 200 bodies falling onto the floor (the plate isn't a collider and is left out here). **2.** The twin world declaring the same 200 bodies one by one from the scatter's `geometry` rows. |

## Readings (`report.json`)

| What | Reading |
|---|---|
| Turned: frames of panel 1 pixel-identical to panel 2 | 120 of 121. Frame 76 differs in 1 pixel of 230,400 by 1 level in one channel. |
| Turned: panel 3 against panel 1 at frame 76 | 22,010 pixels differ, by up to 218 levels |
| Turned: the drawn columns (`evaluate` of `params/pos`, `params/rot`, taken through the instancer's transform) against each body's baked pose, every frame | at most 1.9e-8 m (criterion: 1e-6 m) |
| Turned: the instancer's own `at/pos` over the 121 frames | never moves (0 m) |
| Turned: how far the tiles fell in 2 s | 0.35 m to 4.22 m |
| Scatter: elements, bodies built, built in element-ID order | 200, 200, yes |
| Scatter: bodies as built against the scatter's `geometry` poses | at most 3.2e-7 m |
| Scatter: step hashes equal to the one-by-one twin | 601 of 601 |
| Scatter: panel 1 against panel 2 at t = 0, and over the clip | pixel-identical; 151 of 151 frames pixel-identical |

## Refusals (`report.json`, `refusals`)

- **This change, the turned scene plus the channel `nudge` on `items/tiles/at/pos`:** `physics.moved_instancer` at
  `outputs/written/to`, `actual` `nudge`. Its `what` names `tiles` and `nudge`.
- **The base (b6317234f):** the turned scene, the scatter and the channel scene are each refused with
  `physics.unsupported` at `bodies/<body>/each`, naming #2288. The base never names the channel.

// #2691.ee689a34: On Metal, #1903's every-pass scene at 3456 × 2234 and internal scale 0.5 renders its mirror at
// 864 × 559, and the device holds at least 90 MB less for it than on the merge base (drafted from three quarters of
// 137.6 MB). On the merge base the mirror is 1728 × 1117, and the test fails, naming the size.
//
// One release `deep-gpu run` on this Mac's Metal GPU, one `view3d` call of the every-pass scene (../2189's copy,
// unchanged) at 3456 × 2234 through a surface at internal scale 0.5, eight frames at 60 fps with `timings`, no stub.
// `view3d` draws at the size and surface it is given with no class fit; the check refuses this scene at this size
// through `envelope` (../2189), so that call never draws it.
//   - The mirror's size is the reply's `surface.mirror_px`, the size in px its mirror's pass drew at (README: Surface
//     choices). A reply that names none, as the merge base's does, fails.
//   - What the device holds for the scene is the largest `gpu_bytes` of the eight frames: Metal's allocated size as
//     each frame draws. The merge base's is fixtures/base/every-pass.json, the same reading as this suite's run on
//     the unchanged base kept it (README: The merge base's readings); on another machine it is INCONCLUSIVE.
// The run keeps its reading as target/acceptance/2691/every-pass.json. Off macOS, or with no Metal device, INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  AC, ENVELOPE_LOOK, EVERY_PASS, FULL_SCREEN, by, drewOf, framesOf, keep, mergeBase, num, requireMetal, runGpu, useOut, useRelease, view3d,
  type JsonValue, type Size,
} from './helpers.ts';

/** The criterion's sizes: the mirror's pass at internal scale 0.5, and the merge base's. */
const MIRROR: Size = [864, 559];
const MERGE_BASE_MIRROR: Size = [1728, 1117];
/** "At least 90 MB less": MB as the budget classes count them, 10^6 B. */
const LESS_BYTES = 90_000_000;
const FRAMES = 8;

const bin = useRelease();
const out = useOut();

describe(`${AC[1]} the every-pass scene's mirror at full screen and internal scale 0.5`, () => {
  it(`${AC[1]} on Metal the every-pass scene at 3456 × 2234 and internal scale 0.5 renders its mirror at 864 × 559, and the device holds at least 90 MB less for it than on the merge base, whose mirror is 1728 × 1117`, () => {
    requireMetal();
    const dir = out();
    const [reply] = runGpu(bin(), dir, [view3d({ doc: EVERY_PASS, look: ENVELOPE_LOOK, size: FULL_SCREEN, frames: FRAMES, fps: 60, timings: true, surface: { internal_scale: 0.5 } })]);
    const what = `the every-pass scene at ${by(FULL_SCREEN)} and internal scale 0.5`;
    const drew = drewOf(reply!, what);
    const bytes = framesOf(reply!, what).map((f) => num(f.raw['gpu_bytes'], `${what}: frame ${f.frame}'s gpu_bytes`));
    const peak = Math.max(...bytes);
    console.log(`${AC[1]}: ${what}: mirror ${drew.mirror_px ? by(drew.mirror_px) : JSON.stringify(drew.mirror_raw)}, the device's bytes by frame ${bytes.join(', ')}; kept as ${keep('every-pass', {
      size_px: drew.size_px, internal_scale: drew.internal_scale, internal_px: drew.internal_px, mirror_px: drew.mirror_px, gpu_bytes: bytes, peak_bytes: peak,
    })}`);
    expect(bytes.length, `${what} drew ${FRAMES} frames`).toBe(FRAMES);
    expect([drew.internal_scale, drew.size_px, drew.internal_px], `${what} drew through a ${by(FULL_SCREEN)} surface at internal scale 0.5, ${by([1728, 1117])} internal px`).toEqual([0.5, FULL_SCREEN, [1728, 1117]]);

    // The mirror's size. Both failures below are reported, so the size and the bytes each show.
    const named = drew.mirror_px === null
      ? `the reply names no size for the mirror's pass (surface.mirror_px is ${JSON.stringify(drew.mirror_raw)}), as the merge base's names none: there the pass is half the frame's full ${by(FULL_SCREEN)}, ${by(MERGE_BASE_MIRROR)} (the issue)`
      : `the mirror's pass drew at ${by(drew.mirror_px)}${drew.mirror_px[0] === MERGE_BASE_MIRROR[0] && drew.mirror_px[1] === MERGE_BASE_MIRROR[1] ? ', the merge base\'s size: half the frame\'s full size' : ''}`;
    expect.soft(drew.mirror_px, `${what} renders its mirror at ${by(MIRROR)}, half of its internal ${by([1728, 1117])} rounded up: ${named}`).toEqual(MIRROR);

    // What the device holds, against the merge base's reading on this machine.
    const base = mergeBase('every-pass');
    expect([base['size_px'], base['internal_scale'], (base['gpu_bytes'] as JsonValue[] | undefined)?.length], 'the merge base\'s reading is of the same call').toEqual([FULL_SCREEN, 0.5, FRAMES]);
    const held = num(base['peak_bytes'], 'the merge base\'s peak_bytes');
    expect(held - peak, `the device holds at least ${LESS_BYTES} B less for the scene than on the merge base: ${peak} B here, ${held} B on the merge base, ${held - peak} B less`).toBeGreaterThanOrEqual(LESS_BYTES);
  }, 1_800_000);
});

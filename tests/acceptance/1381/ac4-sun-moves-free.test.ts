// AC4 #1381.4970e130: "Moving the sun runs no GPU compute and no rebuild, by pass count"
//
// Fixture (helpers.ts `ridgeDoc`, README: Fixtures): the sunset. Criterion 1's ridge plate with its horizon, seen from
// the valley's south end by a still camera, the key sun's cascades ending 300 m out; a channel sinks the sun from 15° at
// 0 s to 3° at 3 s, the only thing that moves. Drawn by `view3d` at 640 × 360, 10 frames a second, frames 0 to 30, with
// `counts` (README: Assumed surfaces 4) and `ground_points` at (−224, 0), 800 m east of the crest and 2.7 km from the eye,
// past the last cascade, where the crest stands atan(100 ÷ 800) = 7.13°.
//
// The first test, the sunset: frame 0 bakes the plate's horizon (`horizons_baked` at least 1: the counter sees the bake);
// every later frame, each with the sun lower, runs no compute pass (`compute_passes` 0), builds no mesh (`meshes_built`
// 0) and bakes no horizon (`horizons_baked` 0). So the sun is seen to move: the point reads lit at frame 0 (the sun 15°,
// at least 0.95) and in shadow at frame 30 (3°, at most 0.05), and frames 0 and 30 differ by pixel hash.
// The second test, so the pass count can see compute at all: the same sunset with one swaying tree beside the eye, whose
// GPU deform (#2016) runs a compute pass each frame, reports at least one compute pass in every frame from 1 to 3.
//
// Catches: the base (no `horizon`, no counters); a horizon re-baked, or a plate rebuilt, when the sun moves; a sun's
// visibility traced on the GPU each frame; a compute counter that never counts.
import { describe, expect, it } from 'vitest';
import {
  AC, CREST_X, PLAIN, SMALL, SUNSET_FPS, SUNSET_FRAMES, framesOf, groundPoints, groundRows, int, pixelHash, requireMetal, ridgeDoc, runGpu,
  sunsetElevation, useGpu, useOut, writeJson, type JsonObject, type Xz,
} from './helpers.ts';

const ID = AC[4];
const NAME = `AC4 ${ID}`;
const bin = useGpu();
const out = useOut();
const FAR: Xz = [CREST_X + 800, 0];
const count = (f: JsonObject, key: string, what: string): number => int(f[key], `${what}: counts' ${key} (README: Assumed surfaces 4)`);

describe(`${NAME} the sun moves for free`, () => {
  it(`${NAME} as the sun sinks from 15° to 3° over 30 frames, no frame after the first runs a compute pass, builds a mesh or bakes a horizon`, () => {
    requireMetal();
    const what = 'the sunset';
    const doc = writeJson(out(), 'sunset', ridgeDoc({ size: SMALL, sun: 'sunset', view: 'sunset' }));
    const [reply] = runGpu(bin(), out(), [{
      call: 'view3d', doc, look: PLAIN, size: [...SMALL], fps: SUNSET_FPS, frames: SUNSET_FRAMES, counts: true,
      capture: [0, SUNSET_FRAMES - 1], targets: ['final'], ground_points: groundPoints([FAR]),
    }]);
    const frames = framesOf(reply!, SUNSET_FRAMES, what);
    expect(count(frames[0]!, 'horizons_baked', `${what}, frame 0`), 'frame 0 bakes the plate\'s horizon').toBeGreaterThanOrEqual(1);
    const work: string[] = [];
    frames.slice(1).forEach((f) => {
      const n = Number(f['frame']);
      const at = `${what}, frame ${n} (the sun at ${sunsetElevation(n / SUNSET_FPS).toFixed(1)}°)`;
      for (const key of ['compute_passes', 'meshes_built', 'horizons_baked']) {
        const c = count(f, key, at);
        if (c !== 0) work.push(`${at}: ${key} ${c}`);
      }
    });
    expect(work, 'no frame after the first runs a compute pass, builds a mesh or bakes a horizon while only the sun moves').toEqual([]);

    const first = groundRows(frames[0]!, [FAR], `${what}, frame 0`)[0]!;
    const last = groundRows(frames[SUNSET_FRAMES - 1]!, [FAR], `${what}, frame ${SUNSET_FRAMES - 1}`)[0]!;
    console.log(`${ID}: (${FAR.join(', ')}) reads sun_visibility ${first.sun.toFixed(3)} at 15° and ${last.sun.toFixed(3)} at 3°`);
    expect(first.sun, `at frame 0 (the sun at 15°, the crest at 7.13°) the point (${FAR.join(', ')}) is lit`).toBeGreaterThanOrEqual(0.95);
    expect(last.sun, `at frame ${SUNSET_FRAMES - 1} (the sun at 3°) the point (${FAR.join(', ')}) is in the ridge's shadow`).toBeLessThanOrEqual(0.05);
    expect(pixelHash(frames[0]!, `${what}, frame 0`), 'the sunset\'s first and last frames draw other pixels: the sun moved')
      .not.toBe(pixelHash(frames[SUNSET_FRAMES - 1]!, `${what}, frame ${SUNSET_FRAMES - 1}`));
  }, 3_600_000);

  it(`${NAME} the pass count sees compute: the sunset with one swaying tree reports a compute pass in every frame from 1 to 3`, () => {
    requireMetal();
    const what = 'the sunset with a swaying tree';
    const doc = writeJson(out(), 'sunset-tree', ridgeDoc({ size: SMALL, sun: 'sunset', view: 'sunset', tree: true }));
    const [reply] = runGpu(bin(), out(), [{ call: 'view3d', doc, look: PLAIN, size: [...SMALL], fps: SUNSET_FPS, frames: 4, counts: true }]);
    const frames = framesOf(reply!, 4, what);
    const idle = frames.slice(1).filter((f) => count(f, 'compute_passes', `${what}, frame ${String(f['frame'])}`) < 1).map((f) => `frame ${String(f['frame'])}`);
    expect(idle, 'every frame with a swaying tree counts the sway\'s compute pass').toEqual([]);
  }, 3_600_000);
});

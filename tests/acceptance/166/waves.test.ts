// #166.f045d1c5: "A lake fixture with four waves of stated direction, length and amplitude, seen from above, renders a
// surface whose depth at 64 sampled pixels matches the closed-form height within 1 mm on a linear depth readback"
//
// The fixture (640 × 480): a lake plate 16 m × 16 m of 512 × 512 cells (3.1 cm each) at y = 0 whose material carries
// `water: {waves: LAKE_WAVES, ripples: {strength: 0}, rain: 0}`: four waves headed 20°, 110°, 235° and 300°, 9, 6, 4.5
// and 3.2 m long, 0.12, 0.08, 0.05 and 0.03 m high, steepness 0.5, 0.6, 0.4 and 0.7. A black sky. The camera looks
// straight down from 10 m (fov 40° across the width), so the view axis is −Y and a pixel's linear depth is 10 m less the
// surface's height where its centre ray meets it.
//
// The closed form (helpers.ts `trochoid`): each wave lifts a rest point by A cos θ and moves it −s A sin θ along its
// heading, θ = k (D · x0) − √(g k) t. The horizontal move matters: the ray through a pixel meets the surface at a
// displaced point, so the expected depth is solved for the rest point whose displaced point lies on the ray
// (`depthFromAbove`), never read at the pixel's rest position. 64 pixels, drawn with a seeded generator at least 20 px in
// from the edges, at t = 2.5 s (frame 75 at 30 fps), so the waves' travel counts too; the `depth` target (README) at each
// must be within 1 mm of the closed form. Interpolation across a 3.1 cm cell costs at most Σ A k² h² ÷ 8 ≈ 0.05 mm.
//
// Not vacuous: the 64 expected heights span more than 5 cm, so a flat plate fails; a plate moved by height alone (no
// horizontal move: the slope A k times the move s A, up to about 5 mm off on the longest wave), waves travelling the
// other way, or another dispersion fail at most of the pixels.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DARK_SKY, LAKE_WAVES, Lcg, camItem, depthFromAbove, frameAt, framesOf, look3d, plate, readFloats, requireGpu, runGpu, sceneDoc, useGpu,
  useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [640, 480];
const CAM: Cam = { position: [0, 10, 0], target: [0, 0, 0], fov: 40, size: SIZE };
const FRAME = 75; const FPS = 30; const T = FRAME / FPS;

describe(`${AC[1]} the lake's depth matches the closed-form trochoidal height`, () => {
  it(`${AC[1]} seen from above at 2.5 s, the linear depth at 64 sampled pixels is within 1 mm of the closed form`, () => {
    requireGpu();
    const dir = out();
    const doc = sceneDoc('lake-depth', SIZE, {
      cam: camItem(CAM), sky: DARK_SKY,
      'lake-water': waterMaterial({ waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 0 }, { roughness: 0.05 }),
      lake: plate([16, 16], [512, 512], [0, 0, 0], 'lake-water'),
    });
    const [reply] = runGpu(bin(), dir, [view3d({ doc: writeJson(dir, 'lake', doc), look: look3d('depth-166'), size: SIZE, frames: 1, from: FRAME, fps: FPS, capture: [FRAME], targets: ['depth'] })]);
    const depth = readFloats(dir, frameAt(framesOf(reply!, 'the lake from above'), FRAME, 'the lake'), 'depth', SIZE, 'the lake');
    const rng = new Lcg(166);
    const failures: string[] = []; const heights: number[] = []; let worst = 0;
    for (let n = 0; n < 64; n++) {
      const i = 20 + Math.floor(rng.next() * (SIZE[0] - 40)); const j = 20 + Math.floor(rng.next() * (SIZE[1] - 40));
      const want = depthFromAbove(CAM, LAKE_WAVES, i, j, T);
      heights.push(want.point[1]);
      const got = depth.v[j * SIZE[0] + i]!;
      const off = Math.abs(got - want.depth);
      worst = Math.max(worst, Number.isFinite(off) ? off : Infinity);
      if (!(off <= 0.001)) failures.push(`pixel (${i}, ${j}): depth ${got.toFixed(5)} m, the closed form ${want.depth.toFixed(5)} m (height ${want.point[1].toFixed(5)} m at x ${want.point[0].toFixed(3)}, z ${want.point[2].toFixed(3)}), off ${(off * 1000).toFixed(2)} mm`);
    }
    console.log(`${AC[1]}: worst of 64 pixels ${(worst * 1000).toFixed(3)} mm off the closed form; heights ${Math.min(...heights).toFixed(4)} to ${Math.max(...heights).toFixed(4)} m`);
    expect(Math.max(...heights) - Math.min(...heights), 'the sampled closed-form heights span more than 5 cm, so a flat surface fails').toBeGreaterThan(0.05);
    expect(failures, `the depth readback matches the closed-form height within 1 mm at all 64 pixels: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
  });
});

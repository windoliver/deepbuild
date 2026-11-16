// #968.f3b633ac: "On a river whose flow speed rises along its curve from 0.5 to 3 m/s with `foam: {speed: 2}`, foam covers
// all 64 sampled pixels where the speed is above 2.1 m/s and none of 64 where it is below 1.9 m/s"
//
// The fixture (helpers.ts `riverDoc`, 512 × 256): a 40 m × 10 m plate `river` whose material `river-water` carries FLAT
// water (no waves, ripples at 0.1, no rain, the steepness foam off: `foam.threshold` 1), `foam: {threshold: 1, speed:
// 2}` and the flow as a field (README): the vec2 (0.5 + 0.0625 (x + 20), 0) over x and z at `speed` 1, so the river runs
// along +x and its speed rises evenly from 0.5 m/s at its head (x = −20 m) to 3 m/s at its foot (x = 20 m): 1.9 m/s at
// x = 2.4 m and 2.1 m/s at x = 5.6 m. The camera looks straight down from 16 m over x = 4 m (fov 60° across the width:
// x from −5.2 to 13.2 m, z within ±4.6 m), so every pixel sees water and its centre ray meets the water at rest at a
// point whose speed is the field's there. 64 pixels whose point runs faster than 2.1 m/s and 64 slower than 1.9 m/s are
// drawn with a seeded generator, at least 8 px in from the edges, and read at 1.5 s (frame 45 at 30 fps), when both
// phases weigh half.
//
// The foam is read from the `foam` target (#268's): covered is at least 0.5, none is under 1/255, #268's readings. So
// the target is no decoy, each fast pixel is also brighter in `pre_tone` than the same river with no `foam.speed`.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, FLAT, Lcg, RIVER_FLOW, type Water, at1, camItem, frameAt, framesOf, look3d, lumAt, none, onWater, readFloats, requireGpu, riverDoc,
  riverSpeed, runGpu, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [512, 256];
const CAM: Cam = { position: [4, 16, 0], target: [4, 0, 0], fov: 60, size: SIZE };
const LOOK = look3d('river-968');
const AT = 45;

interface Px { i: number; j: number; speed: number }
function samples(): { fast: Px[]; slow: Px[] } {
  const rng = new Lcg(9680); const fast: Px[] = []; const slow: Px[] = [];
  for (let n = 0; n < 1_000_000 && (fast.length < 64 || slow.length < 64); n++) {
    const i = 8 + Math.floor(rng.next() * (SIZE[0] - 16)); const j = 8 + Math.floor(rng.next() * (SIZE[1] - 16));
    const speed = riverSpeed(onWater(CAM, i, j)![0]);
    if (speed > 2.1 && fast.length < 64) fast.push({ i, j, speed });
    else if (speed < 1.9 && slow.length < 64) slow.push({ i, j, speed });
  }
  return { fast, slow };
}

describe(`${AC[2]} foam covers the river where it runs faster than foam.speed`, () => {
  it(`${AC[2]} with foam speed 2 on a river rising from 0.5 to 3 m/s, foam covers all 64 sampled pixels above 2.1 m/s and none of 64 below 1.9 m/s`, () => {
    requireGpu();
    const dir = out();
    const { fast, slow } = samples();
    expect([fast.length, slow.length], 'the seeded draw found 64 pixels above 2.1 m/s and 64 below 1.9 m/s').toEqual([64, 64]);
    const river = (name: string, water: Water) => writeJson(dir, name, riverDoc(`river-${name}`, SIZE, camItem(CAM), water));
    const [foamy, plain] = runGpu(bin(), dir, [
      view3d({ doc: river('foamy', { ...FLAT, foam: { threshold: 1, speed: 2 }, flow: RIVER_FLOW }), look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['foam', 'pre_tone'] }),
      view3d({ doc: river('plain', { ...FLAT, foam: { threshold: 1 }, flow: RIVER_FLOW }), look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['pre_tone'] }),
    ]);
    const f = frameAt(framesOf(foamy!, 'the river with foam speed 2'), AT, 'the river with foam speed 2');
    const p = frameAt(framesOf(plain!, 'the river with no foam speed'), AT, 'the river with no foam speed');
    const foam = readFloats(dir, f, 'foam', SIZE, 'the river with foam speed 2');
    const lit = readFloats(dir, f, 'pre_tone', SIZE, 'the river with foam speed 2');
    const bare = readFloats(dir, p, 'pre_tone', SIZE, 'the river with no foam speed');
    const failures: string[] = [];
    for (const { i, j, speed } of fast) {
      const v = at1(foam, i, j);
      if (!(v >= 0.5)) failures.push(`material river-water: pixel (${i}, ${j}), where the river runs ${speed.toFixed(3)} m/s (above 2.1), shows foam ${v.toFixed(3)}, not covered`);
      const a = lumAt(lit, i, j); const b = lumAt(bare, i, j);
      if (!(a > b)) failures.push(`material river-water: pixel (${i}, ${j}), where the river runs ${speed.toFixed(3)} m/s, is no whiter with its foam (${a.toFixed(5)}) than with no foam speed (${b.toFixed(5)})`);
    }
    for (const { i, j, speed } of slow) {
      const v = at1(foam, i, j);
      if (!(v < 1 / 255)) failures.push(`material river-water: pixel (${i}, ${j}), where the river runs ${speed.toFixed(3)} m/s (below 1.9), shows foam ${v.toFixed(4)}`);
    }
    const min = Math.min(...fast.map(({ i, j }) => at1(foam, i, j))); const max = Math.max(...slow.map(({ i, j }) => at1(foam, i, j)));
    console.log(`${AC[2]}: foam at the 64 pixels above 2.1 m/s at least ${min.toFixed(3)}; at the 64 below 1.9 m/s at most ${max.toFixed(4)}`);
    none(failures, 'foam by the river\'s speed');
  });
});

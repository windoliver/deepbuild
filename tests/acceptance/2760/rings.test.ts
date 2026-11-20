// #2760.a4531c1e: "A logic item's list holds three touches at the plate's center, 0.5 s apart from t = 1 s. At t = 2.25 s
// the three rings' radii are 0.375, 0.225 and 0.075 m, each within 1 mm of speed × age and centered within 1 mm of its
// occurrence's point. A planted material that places rings by the rain's hash puts them elsewhere and fails, naming the
// occurrence"
//
// The fixture (helpers.ts `pondDoc`, 480 × 270): the still pond `pond`, 4 m × 4 m centred on (1, 0, −0.5) m, whose
// material `rings-water` carries `rings: {on: {list: "taps.occurrences", kinds: ["touch"]}}`, every other field of
// `rings` at its default (speed 0.3 m/s, span 2 s). The logic item `taps` (60 Hz) emits `touch {point: vec3, n: i32}` at
// steps 60, 90 and 120 (1, 1.5 and 2 s), each at the plate's centre. The film is played from frame 0 to frame 45 at
// 20 fps (2.25 s), and frame 45's `rings` rows (README: `view3d`'s `rings`) are the record the renderer draws from.
//
// At 2.25 s the rows list exactly three rings, one per occurrence of the list, on `pond`; their radii are the issue's
// 0.375, 0.225 and 0.075 m within 1 mm, each within 1 mm of 0.3 m/s × (2.25 s − its occurrence's flick), each centred
// within 1 mm of (1, −0.5), the centre in world x and z, and born at its occurrence's flick. Not vacuous: the rings are
// drawn (frame 45 of the same pond with `rings: "none"` has another pixel hash).
// The planted material (`deep-gpu run --planted water_rings_at_rain_hash`): each occurrence's ring centred where the
// rain's hash puts a drop, not at its occurrence's point. The same check must fail, each failure naming its occurrence
// by its index in `taps.occurrences`. Wrong programs: rings at hashed places, at the world's origin or in the plate's
// own coordinates, a radius from the rain's life or from a frame count, a ring per frame or none at all.
import { describe, expect, it } from 'vitest';
import {
  AC, CENTRE, POND, STILL, TAPS, TAPS_LIST, TAP_RINGS, type JsonObject, type Planted, type Ring, alive, failsNaming, frameAt, framesOf, hashAt, logicItem, look3d, none,
  pondDoc, putAsset, requireGpu, ringFailures, ringsOf, runGpu, threeTouches, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('rings-2760');
const FPS = 20;
const AT = 45; // 2.25 s
const T = AT / FPS;

/** Frame 45 of the played film: its rings, the criterion's failures, and its pixel hash beside the ringless pond's. */
function at225(planted?: Planted): { rings: Ring[]; failures: string[]; hash: string; bare: string } {
  const dir = out();
  const taps = threeTouches();
  const assets = putAsset(dir, taps.program);
  const logic: Record<string, JsonObject> = { [TAPS]: logicItem(taps) };
  const doc = writeJson(dir, 'three', pondDoc('three-rings', SIZE, { ...STILL, rings: TAP_RINGS }, logic));
  const bare = writeJson(dir, 'bare', pondDoc('no-rings', SIZE, { ...STILL, rings: 'none' }, logic));
  const [played, ringless] = runGpu(bin(), dir, [
    view3d({ doc, look: LOOK, size: SIZE, frames: AT + 1, fps: FPS, capture: [AT], rings: true, assets }),
    view3d({ doc: bare, look: LOOK, size: SIZE, from: AT, frames: 1, fps: FPS, assets }),
  ], planted);
  const frame = frameAt(framesOf(played!, 'the played film'), AT, 'the played film');
  const rings = ringsOf(frame, 'the played film');
  return { rings, failures: ringFailures(rings, alive(taps.rows, T), T, TAPS_LIST), hash: frame.pixel_hash, bare: hashAt(ringless!, AT, 'the pond with rings: none') };
}

describe(`${AC[1]} three touches at the plate's centre start three rings, each a closed form of its occurrence's point, its flick and t`, () => {
  it(`${AC[1]} at 2.25 s the three rings' radii are 0.375, 0.225 and 0.075 m, each within 1 mm of speed × age and centred within 1 mm of its occurrence's point`, () => {
    requireGpu();
    const { rings, failures, hash, bare } = at225();
    console.log(`${AC[1]}: at 2.25 s ${rings.map((r) => `occurrence ${r.occurrence} at (${r.x}, ${r.z}) born ${r.born} s radius ${r.radius} m`).join('; ') || 'no ring is listed'}`);
    none(failures, 'each touch\'s ring at its occurrence\'s point, with radius speed × age');
    expect(rings.length, 'three rings are alive at 2.25 s, one per touch').toBe(3);
    [0.375, 0.225, 0.075].forEach((radius, i) => {
      const ring = rings.find((r) => r.occurrence === i)!;
      expect(ring.part, `the ring of touch ${i + 1} is on the pond`).toBe(POND);
      expect(Math.abs(ring.radius - radius), `the ring of touch ${i + 1} has radius ${radius} m within 1 mm, got ${ring.radius}`).toBeLessThanOrEqual(0.001);
      expect(Math.hypot(ring.x - CENTRE[0], ring.z - CENTRE[2]), `the ring of touch ${i + 1} is centred within 1 mm of the plate's centre (1, −0.5), got (${ring.x}, ${ring.z})`).toBeLessThanOrEqual(0.001);
    });
    expect(bare, 'the rings are drawn: frame 45 of the pond with rings: none has another pixel hash').not.toBe(hash);
  });

  it(`${AC[1]} a planted material that places rings by the rain's hash (--planted water_rings_at_rain_hash) puts them elsewhere and fails, naming the occurrence`, () => {
    requireGpu();
    const { failures } = at225('water_rings_at_rain_hash');
    failsNaming(failures, [0, 1, 2].map((i) => `occurrence ${i} of ${TAPS_LIST}`), 'water_rings_at_rain_hash');
  });
});

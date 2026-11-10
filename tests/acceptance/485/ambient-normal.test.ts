// AC5 #485.d789e487: A sphere whose ambient returns n × 0.5 + 0.5 and whose light returns 0, with tone map none, reads
// (0.5, 0.5, 1.0) within 1/255 at its centre pixel from each of 8 camera positions on an orbit, read on linear targets.
// A planted loop that hands ambient the world-space normal reads (1.0, 0.5, 0.5) at the centre after a quarter orbit
// and fails, naming the pixel.
//
// The fixture (helpers: `orbitDoc`, `ORBIT`): a 1 m sphere at the origin under the operator `normals` (light 0, ambient
// n × 0.5 + 0.5) and an unshadowed sun, a black sky, tone map none at scale 1; 513 × 513, so the centre pixel (256, 256)
// looks straight at the sphere's centre, where the view-space normal is (0, 0, 1) (`reference.ts`: `viewNormalAt`).
// The camera stands 3.5 m away at azimuths 0°, 45°, …, 315° in the horizontal plane, 0° on +Z and the quarter orbit
// (90°) on +X, where the world-space normal at the centre is (1, 0, 0). Each position is its own `view3d` call, all in
// one process on this Mac, read on the linear target.
// 1. Each of the 8 centre pixels reads (0.5, 0.5, 1.0) within 1/255 per channel.
// 2. `--planted loop_world_normal` (the loop hands `ambient` the world-space normal): the check fails, naming the centre
//    pixel at the quarter orbit, which reads (1.0, 0.5, 0.5) within 1/255.
// Wrong programs: the base (no ambient response); n in world or object space; n unnormalized or flipped.
import { describe, expect, it } from 'vitest';
import {
  AC, NORMAL_AMBIENT, ORBIT, PLAIN_LOOK, TIMEOUT, drawFirst, failsNaming, fmtRgb, none, orbitDoc, orbitPinhole, requireMetal, useDir, useGpu,
  type Frame, type Planted,
} from './helpers.ts';
import { viewNormalAt } from './reference.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const [CX, CY] = ORBIT.centre;
const WANT: [number, number, number] = [0.5, 0.5, 1.0];

interface Seen { az: number; f: Frame }
function drawOrbit(planted?: Planted): Seen[] {
  const frames = drawFirst(bin(), dir(), ORBIT.azimuths.map((az) => ({ name: `normals-${az}`, doc: orbitDoc(`normals-${az}`, az, 'normals', NORMAL_AMBIENT), look: PLAIN_LOOK, size: ORBIT.size })), ['linear', 'ids'], planted);
  return frames.map((f, i) => ({ az: ORBIT.azimuths[i]!, f }));
}
/** Each position's centre pixel against `want`; a failure names the position and the pixel. */
function centreFailures(seen: Seen[], want: readonly number[]): string[] {
  const out: string[] = [];
  seen.forEach(({ az, f }) => {
    if (f.ids!.at(CX, CY) !== 'ball') out.push(`azimuth ${az}°: pixel (${CX}, ${CY}) shows ${f.ids!.at(CX, CY) ?? 'nothing'}, not the sphere`);
    const v = f.linear!.at(CX, CY);
    if (v.some((c, k) => !(Math.abs(c - want[k]!) <= 1 / 255))) out.push(`azimuth ${az}°: the centre pixel (${CX}, ${CY}) reads ${fmtRgb(v)} where ${fmtRgb(want)} is wanted within 1/255`);
  });
  return out;
}

describe(`${ID} ambient takes the view-space normal`, () => {
  it(`${ID} a sphere whose ambient returns n × 0.5 + 0.5 and whose light returns 0 reads (0.5, 0.5, 1.0) within 1/255 at its centre pixel from each of 8 camera positions on an orbit, on linear targets`, () => {
    requireMetal();
    for (const az of ORBIT.azimuths) {
      const n = viewNormalAt(orbitPinhole(az), [0, 0, 0], 1, CX, CY)!;
      expect(Math.hypot(n[0], n[1], n[2] - 1), `the reference: at azimuth ${az}° the centre pixel sees the sphere's normal (0, 0, 1) in view space`).toBeLessThan(1e-9);
    }
    none(centreFailures(drawOrbit(), WANT), 'the centre pixel from each of 8 positions');
  }, TIMEOUT);

  it(`${ID} a planted loop that hands ambient the world-space normal (--planted loop_world_normal) reads (1.0, 0.5, 0.5) at the centre after a quarter orbit and fails, naming the pixel`, () => {
    requireMetal();
    const seen = drawOrbit('loop_world_normal');
    failsNaming(centreFailures(seen, WANT), [`azimuth 90°: the centre pixel (${CX}, ${CY})`], '--planted loop_world_normal');
    none(centreFailures(seen.filter((s) => s.az === 90), [1.0, 0.5, 0.5]), '--planted loop_world_normal reads (1.0, 0.5, 0.5) at the centre after a quarter orbit');
  }, TIMEOUT);
});

// AC6 #485.8b6d2f45: The same sphere with an ambient that returns max(dot(n, v), 0) in every channel reads 1.0 within
// 1/255 at its centre pixel and under 0.2 on interior pixels within 2 px of its outline. A planted v that points away
// from the eye reads 0 at the centre and fails, naming the pixel.
//
// AC5's sphere (helpers: `orbitDoc`, `ORBIT`) from azimuth 0°, under the operator `facing` (light 0, ambient
// max(dot(n, v), 0) in every channel), tone map none at scale 1, 513 × 513, read on the linear target on this Mac.
// Interior pixels within 2 px of the outline, from the object-ID target: those whose 3 × 3 block is all the sphere's
// and whose 5 × 5 block holds a pixel that isn't (a pixel takes the item any of its samples covers, #1173). On these,
// n · v is at most 0.145 by `reference.ts`'s `rimReach` (v toward the eye from each point, through #378's pinhole), so
// a correct v reads under 0.2 there; at the centre n = v = (0, 0, 1).
// 1. The centre pixel reads 1.0 within 1/255 in every channel, and each of at least 1,000 rim pixels reads under 0.2
//    in every channel.
// 2. `--planted loop_view_away` (the loop hands `ambient` v pointing away from the eye): the check fails, naming the
//    centre pixel, which reads 0 within 1/255.
// Wrong programs: the base (no ambient response); v constant (0, 0, 1) for every pixel (reads 1 near the outline too, not
// under 0.2); v toward the light or away from the eye; v in world space.
import { describe, expect, it } from 'vitest';
import { AC, FACING_AMBIENT, ORBIT, PLAIN_LOOK, TIMEOUT, drawFirst, failsNaming, fmtRgb, none, orbitDoc, orbitPinhole, requireMetal, useDir, useGpu, within, type Frame, type Planted } from './helpers.ts';
import { rimReach } from './reference.ts';

const ID = AC[6];
const bin = useGpu();
const dir = useDir();
const [CX, CY] = ORBIT.centre;

function drawFacing(planted?: Planted): Frame {
  const [f] = drawFirst(bin(), dir(), [{ name: 'facing', doc: orbitDoc('facing', 0, 'facing', FACING_AMBIENT), look: PLAIN_LOOK, size: ORBIT.size }], ['linear', 'ids'], planted) as [Frame];
  return f;
}
/** The centre pixel against `want` in every channel; a failure names it. */
function centreFailures(f: Frame, want: number): string[] {
  const v = f.linear!.at(CX, CY);
  if (f.ids!.at(CX, CY) !== 'ball') return [`pixel (${CX}, ${CY}) shows ${f.ids!.at(CX, CY) ?? 'nothing'}, not the sphere`];
  return v.every((c) => Math.abs(c - want) <= 1 / 255) ? [] : [`the centre pixel (${CX}, ${CY}) reads ${fmtRgb(v)} where ${want} is wanted in every channel within 1/255`];
}
/** The interior pixels within 2 px of the outline, each under 0.2 in every channel; a failure names the first. */
function rimFailures(f: Frame): string[] {
  const [w, h] = ORBIT.size;
  let count = 0; let over = 0; let first = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!within(f.ids!, 'ball', x, y, 1) || within(f.ids!, 'ball', x, y, 2)) continue;
    count++;
    const v = f.linear!.at(x, y);
    if (v.every((c) => c < 0.2)) continue;
    over++;
    if (!first) first = `pixel (${x}, ${y}), within 2 px of the outline, reads ${fmtRgb(v)}, not under 0.2`;
  }
  if (count < 1_000) return [`only ${count} interior pixels lie within 2 px of the sphere's outline (1,000 expected of this framing)`];
  return over ? [`${first}; ${over} of the ${count} interior pixels within 2 px of the outline read 0.2 or more`] : [];
}

describe(`${ID} ambient takes v, the direction to the eye`, () => {
  it(`${ID} the sphere with an ambient of max(dot(n, v), 0) reads 1.0 within 1/255 at its centre pixel and under 0.2 on interior pixels within 2 px of its outline`, () => {
    requireMetal();
    const reach = rimReach(orbitPinhole(0), [0, 0, 0], 1);
    expect(reach.max, `the reference: n · v on the rim pixels stays under 0.2 for a v toward the eye (${reach.count} pixels)`).toBeLessThan(0.2);
    const f = drawFacing();
    none([...centreFailures(f, 1), ...rimFailures(f)], 'the centre and the rim under max(dot(n, v), 0)');
  }, TIMEOUT);

  it(`${ID} a planted v that points away from the eye (--planted loop_view_away) reads 0 at the centre and fails, naming the pixel`, () => {
    requireMetal();
    const f = drawFacing('loop_view_away');
    failsNaming([...centreFailures(f, 1), ...rimFailures(f)], [`the centre pixel (${CX}, ${CY})`], '--planted loop_view_away');
    none(centreFailures(f, 0), '--planted loop_view_away reads 0 at the centre');
  }, TIMEOUT);
});

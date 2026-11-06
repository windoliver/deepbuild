// AC7 #446.5786734d: A lamp whose casters are its room's furniture casts no shadow of its own shade.
//
// A shadowed point lamp (`shadowed: {points: 1}`, radius 0.02 m) 2.2 m over a floor, seen in plan at 80 px/m, shut inside
// its own closed shade, a 0.4 m box. `casters: furniture`, a collection of the table and the chair. Every floor pixel
// whose ray to the lamp misses the table and the chair by the margin (at least 100,000) reads ρ I cos θ ÷ (π d²) within
// 2%, as if the shade weren't there; floor pixels whose ray meets the table by the margin (at least 2,000) read under 2%
// of that, so the furniture keeps its shadow; and the shade still draws (at least 800 pixels of it). The wrong program is
// a lamp that ignores its casters, the same document at `casters: all`, whose shade shuts the light in: it must fail,
// naming "shade".
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, failsNaming, hitBox, matte, none, only, ortho, orthoPoint, point, readIds, readLinear, requireMetal, runGpu, sessionDoc, sub, unit, useDir, useGpu, view3dCall, writeJson,
  type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [640, 480];
const WIDTH = 8;
const TARGET: V3 = [0, 0, 0];
const RHO = 0.8;
const POWER = 119;
const LAMP: V3 = [0, 0, 2.2];
const TABLE = { size: [1, 0.8, 0.7] as V3, pos: [1.5, 0, 0.35] as V3 };
const CHAIR = { size: [0.5, 0.5, 0.45] as V3, pos: [-1.5, 0.8, 0.225] as V3 };
const MARGIN = 0.05;
const grown = (s: V3, by: number): V3 => [s[0] + 2 * by, s[1] + 2 * by, s[2] + 2 * by];

function lampDoc(casters: string): JsonObject {
  const grey = { material: 'grey' };
  return sessionDoc(`lamp-${casters}`, SIZE, {
    cam: ortho(TARGET, WIDTH), sky: DARK_SKY, grey: matte(RHO),
    floor: box([9, 7, 0.1], [0, 0, -0.05], grey),
    table: box(TABLE.size, TABLE.pos, grey), chair: box(CHAIR.size, CHAIR.pos, grey),
    shade: box([0.4, 0.4, 0.4], LAMP, grey),
    lamp: point(POWER, LAMP, { shadow: true, casters, radius: 0.02, range: 150 }),
  }, { collections: { furniture: { members: ['table', 'chair'] } }, light_policy: { shadowed: { points: 1 } } });
}
function problems(casters: string): string[] {
  const out = dir();
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, `lamp-${casters}`, lampDoc(casters)), size: SIZE, targets: ['linear', 'ids'] })]);
  const f = only(reply!, 'the lamp');
  const l = readLinear(out, f, SIZE, 'the lamp'); const ids = readIds(out, f, 'the lamp');
  const found: string[] = [];
  const I = POWER / (4 * Math.PI);
  let open = 0; let under = 0;
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    if (ids.at(x, y) !== 'floor') continue;
    const [wx, wy] = orthoPoint(TARGET, WIDTH, SIZE, x, y);
    const p: V3 = [wx, wy, 0];
    const to = sub(LAMP, p); const d = Math.hypot(...to); const ray = unit(to);
    const blocked = (m: number): boolean => [TABLE, CHAIR].some((b) => { const h = hitBox(p, ray, b.pos, grown(b.size, m)); return h !== null && h[0] < d; });
    const unshadowed = (RHO * I * (LAMP[2] / d)) / (Math.PI * d * d);
    if (!blocked(MARGIN)) {
      open++;
      if (Math.abs(l.at(x, y) / unshadowed - 1) > 0.02) found.push(`the lamp's shade shadows the floor at (${x}, ${y}): ${l.at(x, y).toFixed(4)}, want ${unshadowed.toFixed(4)}`);
    } else if (blocked(-MARGIN)) {
      under++;
      if (l.at(x, y) > 0.02 * unshadowed) found.push(`the furniture lost its shadow at (${x}, ${y}): ${l.at(x, y).toFixed(4)}`);
    }
  }
  expect(open, 'at least 100,000 floor pixels see the lamp').toBeGreaterThanOrEqual(100_000);
  expect(under, 'at least 2,000 floor pixels lie in the furniture\'s shadow').toBeGreaterThanOrEqual(2_000);
  if ((ids.count.get('shade') ?? 0) < 800) found.push(`the shade doesn't draw: ${ids.count.get('shade') ?? 0} pixels`);
  return found;
}

describe(`${ID} a lamp's casters leave its shade out of its shadow`, () => {
  it(`${ID} the floor reads the lamp's full light with its shade shut around it, the furniture keeps its shadow and the shade still draws; casters all fails`, () => {
    requireMetal();
    none(problems('furniture'), 'casters: furniture');
    failsNaming(problems('all'), ['shade'], 'a lamp that ignores its casters');
  }, 1_800_000);
});

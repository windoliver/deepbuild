// A culled instancer casts as any solid does (#446 under #484): above 256 elements an instancer's shadow in a cascade comes
// from its GPU cull's rows, which hold no owners and no local map's view.
//
// A plate of 400 boxes, one instancer, 1 m over a floor seen in plan; the strip of floor past its edge lies in its shadow
// under a point lamp and under a sun. Each light is drawn with `casters: all` and with `casters: other`, a collection
// that leaves the plate out. Under `all` the strip reads under 2% of what it reads under `other`, and under `other` it
// keeps its light. A local map that skips culled batches fails the lamp's first check, naming it; a cascade that draws
// rows past a caster set fails the sun's second.
import { describe, expect, it } from 'vitest';
import {
  DARK_SKY, box, matte, none, only, ortho, orthoPoint, point, readLinear, requireMetal, runGpu, sessionDoc, sun, useDir, useGpu, view3dCall, writeJson,
  type JsonObject, type Linear, type V3,
} from './acceptance/446/helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 360];
const WIDTH = 6;
const TARGET: V3 = [0, 0, 0];
const SPACING = 0.1;
const SIDE = 20;
const LIGHTS: Record<string, (casters: string) => JsonObject> = {
  lamp: (casters) => point(40, [2, 0, 3], { shadow: true, casters, radius: 0.02, range: 50 }),
  sun: (casters) => sun(Math.PI, [0, 45, 0], { shadow: true, casters, cascades: 1 }),
};

function doc(light: string, casters: string): JsonObject {
  const grey = { material: 'grey' };
  const place = (i: number): number => (i + 0.5) * SPACING - (SIDE * SPACING) / 2;
  const pos: V3[] = Array.from({ length: SIDE * SIDE }, (_, i) => [place(i % SIDE), place(Math.floor(i / SIDE)), 1]);
  return sessionDoc(`${light}-${casters}`, SIZE, {
    cam: ortho(TARGET, WIDTH), sky: DARK_SKY, grey: matte(0.8),
    floor: box([20, 20, 0.1], [0, 0, -0.05], grey),
    stub: box([0.1, 0.1, 0.1], [9, 9, 1], grey),
    tile: box([SPACING, SPACING, SPACING], [0, 0, 0], { ...grey, visible: false }),
    plate: { kind: 'instance@1', params: { of: ['tile'], ids: pos.map((_, i) => i), pos } },
    light: LIGHTS[light]!(casters),
  }, { collections: { other: { members: ['stub'] } }, light_policy: { shadowed: { points: 1 } } });
}
function pictures(): Record<string, Linear> {
  const out = dir();
  const names = Object.keys(LIGHTS).flatMap((l) => [`${l}-all`, `${l}-other`]);
  const calls = names.map((n) => { const [l, c] = n.split('-') as [string, string]; return view3dCall({ doc: writeJson(out, n, doc(l, c)), size: SIZE, targets: ['linear'] }); });
  const replies = runGpu(bin(), out, calls);
  return Object.fromEntries(names.map((n, i) => [n, readLinear(out, only(replies[i]!, n), SIZE, n)]));
}

describe('#446 a culled instancer casts', () => {
  it('into a local map and under a caster set', () => {
    requireMetal();
    const seen = pictures();
    const wrong: string[] = [];
    let strip = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      const [wx, wy] = orthoPoint(TARGET, WIDTH, SIZE, x, y);
      if (wx < -1.9 || wx > -1.1 || Math.abs(wy) > 0.5) continue;
      strip++;
      for (const light of Object.keys(LIGHTS)) {
        const [shut, open] = [seen[`${light}-all`]!.at(x, y), seen[`${light}-other`]!.at(x, y)];
        if (open < 0.02) wrong.push(`the plate shades ${light} light it isn't a caster of at (${x}, ${y}): ${open.toFixed(4)}`);
        else if (shut > 0.02 * open) wrong.push(`the plate casts no shadow under the ${light} at (${x}, ${y}): ${shut.toFixed(4)} of ${open.toFixed(4)}`);
      }
    }
    expect(strip, 'the strip holds at least 2,000 pixels').toBeGreaterThanOrEqual(2000);
    none(wrong, 'the culled plate\'s shadows');
  }, 900_000);
});

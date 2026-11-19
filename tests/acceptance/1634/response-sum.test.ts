// AC7 #1634.e8a4deec: A three-band light response (#485) under 200 fill lamps, at a pixel inside all 200 ranges, sums
// 200 calls: a response that returns 0.01 a call reads 2.00 within 0.5%.
//
// The glow (helpers: `glowDoc`): a floor under 200 fill lamps 2 m up, each with a 5 m range; the floor's material
// operator answers each shaded light through a three-band response, 0.005 × min(floor(3 × max(dot(n, l), 0) × shadow),
// 2) in every channel, whose top band is 0.01, with an ambient of 0. The pixel is the frame's centre, (240, 160), on
// the floor under the lattice's middle: by the CPU reference every lamp is within 2.48 m of it (inside its range) and
// stands at dot(n, l) ≥ 0.807, in the top band (a fill light's shadow is 1), so each of the 200 calls returns 0.01.
// The document's `light_policy.per_cluster` is 200, so the pixel's cluster shades all 200.
// One frame's linear target: the centre pixel reads 2.00 within 0.5% (1.99 to 2.01) in every channel, and it shows
// the floor in the object-ID target.
// Wrong programs: the base (it reads no `fill` and no `per_cluster`, so the 200 are key lights, it shades 32 of them,
// most inside the cut's margin, and the pixel reads 0.04; BASE-FAILURE.txt); a cluster that calls the response for
// its first 64 lights (0.64); a loop that calls it once a pixel, or for lights whose range the pixel is outside; fill
// lights shaded by the core's own lobe beside the response.
import { describe, expect, it } from 'vitest';
import { AC, GLOW, PLAIN_LOOK, TIMEOUT, frameAt, framesOf, glowDoc, glowLamps, requireMetal, runGpu, useDir, useGpu, view3dCall, within, writeJson } from './helpers.ts';
import { groundAt, len, sub } from './reference.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();

describe(`${ID} a light response is called once for each fill lamp in the pixel's cluster`, () => {
  it(`${ID} under 200 fill lamps, at a pixel inside all 200 ranges, a three-band response whose band returns 0.01 a call reads 2.00 within 0.5%`, () => {
    requireMetal();
    const p = groundAt(GLOW.cam, GLOW.pixel[0], GLOW.pixel[1])!;
    for (const l of glowLamps()) {
      const d = len(sub(l.pos, p));
      expect(d, `the fixture: ${l.id} holds the pixel inside its range`).toBeLessThan(l.range / 2);
      expect((l.pos[1] - p[1]) / d, `the fixture: ${l.id} stands in the top band at the pixel`).toBeGreaterThan(0.75);
    }
    const out = dir();
    const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'glow', glowDoc()), look: PLAIN_LOOK, size: GLOW.size, targets: ['linear', 'ids'] })]);
    const f = frameAt(framesOf(out, reply!, GLOW.size, 'the glow'), 0, 'the glow');
    const [x, y] = GLOW.pixel;
    expect(within(f.ids!, 'floor', x, y, 2), `pixel (${x}, ${y}) and its neighbours show the floor`).toBe(true);
    const got = f.linear!.at(x, y);
    const want = GLOW.lamps * GLOW.each;
    console.log(`${ID}: pixel (${x}, ${y}) reads [${got.map((c) => c.toFixed(4)).join(', ')}]; 200 calls of 0.01 sum to ${want.toFixed(2)}`);
    for (const c of got) expect(Math.abs(c / want - 1), `pixel (${x}, ${y}) reads [${got.map((v) => v.toFixed(4)).join(', ')}], where 200 calls of 0.01 sum to 2.00 within 0.5%`).toBeLessThanOrEqual(0.005);
  }, TIMEOUT);
});

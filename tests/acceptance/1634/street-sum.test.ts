// AC1 #1634.d5f3a907: A street of 512 fill point lamps of 800 lm, 3 m high and 10 m apart, range 6 m, in the
// work-product class at 1920 × 1080 with rays off: every lit road pixel's linear radiance equals a CPU f64 sum over
// every lamp in range within 1% on 99.9% of those pixels, read back on one machine. A planted policy that shades only
// the top 32 fails, naming the first dimmed lamp by ID.
//
// The street (helpers: `streetDoc`) seen through `STREET_VIEW`: from 831 m off and 60° up, across the street, 2 px to
// the metre, so the ranges of 98 lamps (lamp_207 … lamp_304) meet the frustum and 96 pools lie in the frame. One frame's
// linear target (before exposure and the tone map) and object-ID target. A road pixel is one whose 3 × 3 block shows
// only `road`, so it lies wholly on the road and its one shading sample is its centre's. Its CPU sum is, at the point
// its centre's ray meets the road, the illuminance of all 512 lamps (lm ÷ 4π cd, the cosine, the inverse square, the
// window), and its radiance 0.8 E ÷ π (the road is a matte of albedo 0.8). It is lit when that sum is at least
// 0.05 lx: the cut at the fixture's exposure, under which a white surface sits below one 8-bit code value (README:
// Readings). At least 15,000 lit pixels are judged; more than 0.1% of them over 1% off, in any channel, fails. The
// failure names the first dimmed lamp by ID: the first lamp, in ID order, whose own pixels (the lit pixels it is
// nearest to, at least 20) read under 0.99 of the sum at their median.
// Wrong programs: the base (which reads no `fill`, so the 98 are key lights and it shades 32); `--planted fill_top_32`
// (fill lights under the key policy's 32 and its margin), which must fail naming the first lamp with pixels in the
// frame that the CPU reference of that policy leaves under weight 0.99; a window, a falloff or a cosine that isn't the
// design's; a light dropped at a tile's or a slice's edge.
import { describe, expect, it } from 'vitest';
import {
  AC, STREET, STREET_VIEW, TIMEOUT, failsNaming, frameAt, framesOf, median, none, requireMetal, runGpu, streetDoc, streetLamps, streetLook, useDir, useGpu,
  view3dCall, within, writeJson, type Planted,
} from './helpers.ts';
import { cutAt, groundAt, illuminanceSum, matteRadiance, ordered, type V3 } from './reference.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();
const UP: V3 = [0, 1, 0];
const MIN_LIT = 15_000;
const OWN_PIXELS = 20;

interface Judged { failures: string[]; lit: number; pixelsOf: Map<string, number[]> }
/** The street's frame against the CPU sum: the failures, and each lamp's own pixels' readings over the sum. */
function judge(planted?: Planted): Judged {
  requireMetal();
  const out = dir();
  const doc = writeJson(out, 'street', streetDoc('street-512', { camera: STREET_VIEW }));
  const [reply] = runGpu(bin(), out, [view3dCall({ doc, look: streetLook(), size: STREET.size, targets: ['linear', 'ids'] })], planted ? { planted } : {});
  const f = frameAt(framesOf(out, reply!, STREET.size, 'the street'), 0, 'the street');
  expect(f.linear && f.ids, 'the frame holds its linear and object-ID targets').toBeTruthy();
  const lamps = streetLamps();
  const pixelsOf = new Map<string, number[]>();
  let lit = 0; let off = 0; let first = '';
  for (let y = 0; y < STREET.size[1]; y++) for (let x = 0; x < STREET.size[0]; x++) {
    if (!within(f.ids!, 'road', x, y, 1)) continue;
    const p = groundAt(STREET_VIEW, x, y);
    if (!p) continue;
    const lux = illuminanceSum(lamps, p, UP);
    if (lux < STREET.lit) continue;
    lit++;
    const want = matteRadiance(STREET.rho, lux);
    const got = f.linear!.at(x, y);
    const nearest = lamps[Math.min(lamps.length - 1, Math.max(0, Math.round((p[0] + 2555) / STREET.spacing)))]!.id;
    pixelsOf.set(nearest, [...(pixelsOf.get(nearest) ?? []), got[0] / want]);
    if (Math.max(...got.map((c) => Math.abs(c / want - 1))) > 0.01) {
      off++;
      if (!first) first = `pixel (${x}, ${y}), by ${nearest}, reads [${got.map((c) => c.toFixed(5)).join(', ')}] where the sum gives ${want.toFixed(5)}`;
    }
  }
  expect(lit, `the frame holds at least ${MIN_LIT} lit road pixels to judge`).toBeGreaterThanOrEqual(MIN_LIT);
  const failures: string[] = [];
  if (off > 0.001 * lit) {
    const dimmed = lamps.map((l) => l.id).find((id) => (pixelsOf.get(id)?.length ?? 0) >= OWN_PIXELS && median(pixelsOf.get(id)!) < 0.99);
    const named = dimmed ? `the first dimmed lamp is ${dimmed}, whose ${pixelsOf.get(dimmed)!.length} pixels read ${median(pixelsOf.get(dimmed)!).toFixed(3)} of the sum at their median` : 'no lamp is dimmed as a whole';
    failures.push(`${off} of ${lit} lit road pixels (${((100 * off) / lit).toFixed(2)}%, over 0.1%) read more than 1% off the CPU sum over every lamp in range; ${named}; the first such pixel: ${first}`);
  }
  console.log(`${ID}${planted ? ` --planted ${planted}` : ''}: ${lit} lit road pixels, ${off} more than 1% off the CPU sum`);
  return { failures, lit, pixelsOf };
}

describe(`${ID} the street of 512 fill lamps reads the CPU sum over every lamp in range`, () => {
  it(`${ID} every lit road pixel's linear radiance is within 1% of the CPU f64 sum over every lamp in range on 99.9% of them, at 1920 × 1080 in the work-product class`, () => {
    none(judge().failures, 'the street against the CPU sum');
  }, TIMEOUT);

  it(`${ID} a planted policy that shades only the top 32 (--planted fill_top_32) fails, naming the first dimmed lamp by ID`, () => {
    const planted = judge('fill_top_32');
    const weights = new Map(cutAt(ordered(STREET_VIEW, streetLamps()), 32).kept.map((k) => [k.id, k.weight]));
    const expected = streetLamps().map((l) => l.id).find((id) => (planted.pixelsOf.get(id)?.length ?? 0) >= OWN_PIXELS && (weights.get(id) ?? 0) < 0.99);
    expect(expected, 'the CPU reference of the 32-light policy dims a lamp with pixels in the frame').toBeDefined();
    console.log(`${ID} --planted fill_top_32: ${planted.failures.join('; ').slice(0, 1500)}`);
    failsNaming(planted.failures, [`the first dimmed lamp is ${expected!},`], '--planted fill_top_32');
  }, TIMEOUT);
});

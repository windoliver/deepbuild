// AC6 #226.86722d38: "With the x scale's domain keyed from [−4, 4] to [−6, 6] over 1 s, the axes' x ticks and their
// opacities equal those of a 2D `axis@1` on the same scale at 20 sampled times, so ticks that enter the domain fade in;
// a planted axes3d with a tick rule of its own that shows an entering tick at full opacity fails, naming the first tick
// that differs"
//
// The x scale `xs` (linear, domain [−4, 4] as written) has its domain's ends keyed linearly to [−6, 6] at 1 s
// (`items/xs/params/domain/0` and `/1`). In 3D: the axes of criterion 1 on it, drawn by `view3d` at 20 fps from frame 1
// for 20 frames, so frame k is t = k ÷ 20 s (k = 1 … 20), each reporting its ticks (`axes`, README: Assumed surfaces 2).
// In 2D: a figure holding the same scale (its range [40, 440] u, the only difference) and the same keys, with an
// `axis@1` on it, read by the base's `deep-canvas-render geometry` at the same 20 times (#167's `ticks`, `{value,
// opacity}`). At each time the ticks shown (opacity > 0) of the 3D x axis equal the 2D axis's, value for value, each
// opacity within 1e-6; the first difference in time order, then value order, is named. So that the comparison sees an
// entering fade, some tick outside [−4, 4] shows in 2D at an opacity strictly between 0 and 1 at some sampled time.
// The second test draws the 3D side under `deep-gpu run --planted axes3d_own_tick_rule` (README: The planted programs):
// the comparison fails, and its first difference is an entering tick (|value| > 4) the plant shows at opacity 1 where
// the 2D axis shows it below 1.
// Wrong programs: the base (no axes3d@1, no `axes` report; its 2D axis under a keyed domain shows ticks at 1 or not at
// all); the plant; a 3D rule on other steps (2 × 10^k at [−6, 6]) or that pops ticks in at the domain's edge.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK_2D, PLAIN, SAMPLES, SAMPLE_FPS, TIMEOUT, arr, framesOf, geometry2d, keyedAxesDoc, keyedAxis2d, num, obj, requireMetal, runGpu, sampleFlicks,
  ticksOf, useBins, useOut, writeJson, type Planted,
} from './helpers.ts';

const ID = AC[6];
const NAME = `AC6 ${ID}`;
const bin = useBins(['deep-gpu', 'deep-canvas-render']);
const out = useOut();

type Shown = Map<number, number>;
/** The 3D axes' x ticks shown (opacity > 0) at each sampled time, value → opacity. */
function ticks3d(planted?: Planted): Shown[] {
  const dir = out();
  const doc = writeJson(dir, 'keyed', keyedAxesDoc([640, 360]));
  const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc, look: PLAIN, size: [640, 360], fps: SAMPLE_FPS, from: SAMPLES[0]!, frames: SAMPLES.length, axes: true }], planted);
  return framesOf(reply!, SAMPLES.length, 'the keyed axes', SAMPLES[0]!).map((f, i) =>
    new Map(ticksOf(f, 'axes', `t = ${SAMPLES[i]}/20 s`).filter((t) => t.axis === 'x' && t.opacity > 0).map((t) => [t.value, t.opacity])));
}
/** The 2D axis@1's ticks shown at each sampled time (#167's `geometry` of an axis). */
function ticks2d(): Shown[] {
  const doc = keyedAxis2d();
  return geometry2d(bin('deep-canvas-render'), SAMPLES.map((k) => ({ doc, item: 'xaxis', t: sampleFlicks(k), look: LOOK_2D }))).map((a, i) => {
    expect(a['code'], `the 2D axis at t = ${SAMPLES[i]}/20 s is answered: ${JSON.stringify(a).slice(0, 600)}`).toBeUndefined();
    return new Map(arr(a['ticks'], `the 2D axis at t = ${SAMPLES[i]}/20 s: ticks`).map((v, j) => {
      const o = obj(v, `the 2D axis: ticks[${j}]`);
      return [num(o['value'], 'a tick\'s value'), num(o['opacity'], 'a tick\'s opacity')] as [number, number];
    }).filter(([, a2]) => a2 > 0));
  });
}
interface Difference { k: number; value: number; a3: number | undefined; a2: number | undefined }
/** Every difference between the two axes' shown ticks, in time order, then value order. */
function differences(a: Shown[], b: Shown[]): Difference[] {
  const out: Difference[] = [];
  SAMPLES.forEach((k, i) => {
    const values = [...new Set([...a[i]!.keys(), ...b[i]!.keys()])].sort((x, y) => x - y);
    for (const value of values) {
      const [a3, a2] = [a[i]!.get(value), b[i]!.get(value)];
      if (a3 === undefined || a2 === undefined || Math.abs(a3 - a2) > 1e-6) out.push({ k, value, a3, a2 });
    }
  });
  return out;
}
const named = (d: Difference): string =>
  `at t = ${d.k}/20 s the x tick at ${d.value} shows at opacity ${d.a3 ?? 'none'} on the 3D axes and ${d.a2 ?? 'none'} on the 2D axis@1`;

describe(`${NAME} the axes' x ticks follow axis@1's rule as the domain grows`, () => {
  it(`${NAME} at 20 sampled times the axes' x ticks and opacities equal a 2D axis@1's on the same keyed scale, and entering ticks fade in`, () => {
    requireMetal();
    const three = ticks3d();
    const two = ticks2d();
    const fades = two.flatMap((m, i) => [...m].filter(([v, a]) => Math.abs(v) > 4 && a > 0 && a < 1).map(([v, a]) => `t = ${SAMPLES[i]}/20 s: ${v} at ${a}`));
    expect(fades.length, 'on the 2D axis a tick entering the domain (|value| > 4) shows at an opacity between 0 and 1 at some sampled time').toBeGreaterThan(0);
    const diff = differences(three, two);
    expect(diff.length === 0 ? [] : [`the first tick that differs: ${named(diff[0]!)}`, `${diff.length} differences in all`], 'the 3D axes\' x ticks equal the 2D axis@1\'s at every sampled time').toEqual([]);
  }, TIMEOUT);

  it(`${NAME} a planted axes3d with a tick rule of its own that shows an entering tick at full opacity fails, naming the first tick that differs`, () => {
    requireMetal();
    const diff = differences(ticks3d('axes3d_own_tick_rule'), ticks2d());
    expect(diff.length, 'the comparison fails the plant').toBeGreaterThan(0);
    const first = diff[0]!;
    console.log(`${ID} the plant's first difference: ${named(first)}`);
    expect(Math.abs(first.value), `the first tick that differs enters the domain: ${named(first)}`).toBeGreaterThan(4);
    const full = diff.filter((d) => Math.abs(d.value) > 4 && d.a3 === 1 && (d.a2 ?? 0) < 1);
    expect(full.length, `the plant shows an entering tick at full opacity where the 2D axis shows it below: ${diff.slice(0, 6).map(named).join('; ')}`).toBeGreaterThan(0);
  }, TIMEOUT);
});

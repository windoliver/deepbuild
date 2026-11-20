// AC9 #1634.d613f0e8: A street of 512 point lamps with automatic ranges, at 800 lm and the fixture's exposure, and
// again at 8 lm with exposure raised by log2 100 EV, gives the same 8-bit frame within 1 code value on 99.9% of road
// pixels and within 2 on every pixel, read back on one machine. A planted automatic range from a fixed 0.05 lx gives
// the 8 lm lamps a 3.6 m range, darkens road pixels between lamps 10 m apart, and fails, naming the first lamp whose
// range changed.
//
// The street with `range` left out of every lamp (helpers: `streetDoc` with `range: 'auto'`), through `STREET_VIEW`
// at 1920 × 1080, drawn twice in one process: its lamps at 800 lm in the look at the fixture's exposure, EV100
// 5.7635, where the cut is 0.05 lx and a range is today's 35.68 m; and at 8 lm in the look at EV100 5.7635 − log2 100
// (raised: 100 times the light on the picture), where the cut is 0.0005 lx and the range 35.68 m again. Each frame's
// final target (the 8-bit picture), object-ID target and `light_cut` (its `fill` gives each lamp's range, README:
// Assumed surfaces 4).
// The check: over the pixels that show `road` in either frame, at most 0.1% differ by more than 1 code value in any
// channel, and no pixel of the frame differs by more than 2; the 800 lm frame is a picture (at least 10,000 road
// pixels read 20 codes or more: the road's middle runs from 22 codes between lamps to 47 under them); both frames list the
// same lamps, at least 100 (lamp_204 … lamp_307, whose 35.68 m ranges meet the frustum), and each lamp's range in each
// frame is the CPU reference's within 0.1% (reference.ts: `autoRange`, √(power ÷ (4π × cut)), the cut
// π ÷ (4,096 × the exposure's scale)). A failure names the first lamp, in ID order, that both frames list and whose
// range differs between them by more than 0.1%, with both ranges.
// Wrong programs: the base (a fixed 0.05 lx, and no `fill`); `--planted auto_range_fixed_cut`, which must fail saying
// the range of lamp_208 (the first lamp a 3.57 m range still brings into the frustum) changed from 35.68 m to 3.57 m,
// with road pixels between lamps over 2 codes darker; a range that follows the exposure but not the power.
import { describe, expect, it } from 'vitest';
import {
  AC, STREET, STREET_VIEW, TIMEOUT, decodePng, failsNaming, fillOf, frameAt, framesOf, none, requireMetal, runGpu, streetDoc, streetLamps, streetLook, useDir, useGpu,
  view3dCall, writeJson, type Frame, type Planted,
} from './helpers.ts';
import { autoRange, reachesFrustum } from './reference.ts';

const ID = AC[9];
const bin = useGpu();
const dir = useDir();
const DIM = { power: 8, ev: STREET.ev - Math.log2(100) };
const fmt = (m: number): string => `${m.toFixed(2)} m`;

/** What is wrong with the two frames; a range that changed is named first. */
function problems(planted?: Planted): string[] {
  requireMetal();
  const out = dir();
  const call = (name: string, power: number, ev: number) =>
    view3dCall({ doc: writeJson(out, name, streetDoc(name, { camera: STREET_VIEW, power, range: 'auto' })), look: streetLook(ev), size: STREET.size, targets: ['final', 'ids'], light_cut: true });
  const replies = runGpu(bin(), out, [call('street-800lm', STREET.power, STREET.ev), call('street-8lm', DIM.power, DIM.ev)], planted ? { planted } : {});
  const [bright, dim] = replies.map((r, i) => frameAt(framesOf(out, r, STREET.size, i === 0 ? 'the street at 800 lm' : 'the street at 8 lm'), 0, 'the street')) as [Frame, Frame];
  const failures: string[] = [];

  const ranges = [bright, dim].map((f, i) => (f.lightCut?.['fill'] === undefined ? null : new Map(fillOf(f, i === 0 ? 'the street at 800 lm' : 'the street at 8 lm').map((l) => [l.light, l.range]))));
  if (!ranges[0] || !ranges[1]) failures.push('a frame\'s light_cut reports no fill lights, so no lamp\'s range can be read');
  else {
    const ids = [...ranges[0].keys()].sort();
    if (ids.length < 100 || ids.join(' ') !== [...ranges[1].keys()].sort().join(' ')) failures.push(`the two frames shade ${ranges[0].size} and ${ranges[1].size} fill lamps, not the same 100 or more`);
    const changed = ids.find((id) => ranges[1]!.has(id) && Math.abs(ranges[1]!.get(id)! / ranges[0]!.get(id)! - 1) > 1e-3);
    if (changed) failures.unshift(`the first lamp whose range changed is ${changed}: ${fmt(ranges[0].get(changed)!)} at 800 lm, ${fmt(ranges[1].get(changed)!)} at 8 lm with exposure raised by log2 100 EV`);
    [[STREET.power, STREET.ev], [DIM.power, DIM.ev]].forEach(([power, ev], i) => {
      const want = autoRange(power!, ev!);
      const wrong = ids.find((id) => Math.abs((ranges[i]!.get(id) ?? Number.NaN) / want - 1) > 1e-3);
      if (wrong) failures.push(`${wrong}'s automatic range at ${power} lm and EV100 ${ev!.toFixed(4)} is ${fmt(ranges[i]!.get(wrong) ?? Number.NaN)}, where the exposure's cut gives ${fmt(want)}`);
    });
  }

  const [a, b] = [decodePng(bright.final!), decodePng(dim.final!)];
  let road = 0; let overOne = 0; let overTwo = 0; let lit = 0; let worst = { x: 0, y: 0, d: 0 };
  for (let y = 0; y < STREET.size[1]; y++) for (let x = 0; x < STREET.size[0]; x++) {
    const o = (y * STREET.size[0] + x) * 4;
    const d = Math.max(Math.abs(a.rgba[o]! - b.rgba[o]!), Math.abs(a.rgba[o + 1]! - b.rgba[o + 1]!), Math.abs(a.rgba[o + 2]! - b.rgba[o + 2]!));
    if (d > 2) overTwo++;
    if (d > worst.d) worst = { x, y, d };
    if (bright.ids!.at(x, y) !== 'road' && dim.ids!.at(x, y) !== 'road') continue;
    road++;
    if (d > 1) overOne++;
    if (a.rgba[o]! >= 20) lit++;
  }
  const px = (o: number, im: typeof a): string => `rgb(${[...im.rgba.subarray(o, o + 3)].join(', ')})`;
  const at = (worst.y * STREET.size[0] + worst.x) * 4;
  const where = `the worst, pixel (${worst.x}, ${worst.y}), reads ${px(at, a)} at 800 lm and ${px(at, b)} at 8 lm`;
  if (lit < 10_000) failures.push(`the 800 lm frame is no picture of the street: ${lit} of ${road} road pixels read 20 codes or more, fewer than 10,000`);
  if (overOne > 0.001 * road) failures.push(`${overOne} of ${road} road pixels (${((100 * overOne) / road).toFixed(2)}%, over 0.1%) differ by more than 1 code value between the two frames; ${where}`);
  if (overTwo > 0) failures.push(`${overTwo} pixels differ by more than 2 code values between the two frames; ${where}`);
  console.log(`${ID}${planted ? ` --planted ${planted}` : ''}: ${road} road pixels, ${overOne} over 1 code apart, ${overTwo} pixels over 2 apart, ${lit} at 20 codes or more`);
  return failures;
}

describe(`${ID} an automatic range takes its cut from the exposure`, () => {
  it(`${ID} the street with automatic ranges at 800 lm and the fixture's exposure, and at 8 lm with exposure raised by log2 100 EV, gives the same 8-bit frame within 1 code value on 99.9% of road pixels and within 2 on every pixel`, () => {
    expect(autoRange(STREET.power, STREET.ev), 'the fixture: at its exposure the cut is 0.05 lx and an 800 lm range today\'s 35.68 m').toBeCloseTo(35.6825, 3);
    expect(autoRange(DIM.power, DIM.ev), 'the fixture: the 8 lm lamps\' range at the raised exposure is the same').toBeCloseTo(35.6825, 3);
    none(problems(), 'the street at two light levels');
  }, TIMEOUT);

  it(`${ID} a planted automatic range from a fixed 0.05 lx (--planted auto_range_fixed_cut) gives the 8 lm lamps a 3.6 m range, darkens road pixels between lamps, and fails, naming the first lamp whose range changed`, () => {
    const failures = problems('auto_range_fixed_cut');
    console.log(`${ID} --planted auto_range_fixed_cut: ${failures.join('; ').slice(0, 2000)}`);
    const fixed = Math.sqrt(DIM.power / (4 * Math.PI * 0.05));
    expect(fixed, 'a fixed 0.05 lx gives an 8 lm lamp a 3.6 m range').toBeCloseTo(3.568, 3);
    const first = streetLamps({ range: fixed }).filter((l) => reachesFrustum(STREET_VIEW, l)).map((l) => l.id).sort()[0]!;
    failsNaming(failures, [`the first lamp whose range changed is ${first}: 35.68 m at 800 lm, 3.57 m at 8 lm`, /pixels differ by more than 2 code values/], '--planted auto_range_fixed_cut');
  }, TIMEOUT);
});

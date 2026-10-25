// #378.a263a507: in a 3D writer layer under each tone map, with the finish at identity, every 8-bit pixel of
// the final frame equals within one code value the CPU's sRGB encoding of the look's exposure and tone map
// applied to the same frame's linear target read back; a planted output that encodes twice (a linear 0.5
// reaching the encode reads 223, not 188) or not at all (128) fails, naming the pass.
// fixtures/grey-bands.json: thirty-two 16 px grey bands from black to white, 188 among them, filling a
// 512 × 512 frame. Each tone map (none, filmic, agx, neutral) at two exposures: the EV100 whose scale is 1
// and one 3 stops brighter (scale 8, so the curves' shoulders are reached). The look's `finish` is empty and
// `deband` none. The CPU's side is this suite's own reference code (helpers.ts: srgbEncode, exposureScale,
// the tone maps; README: Readings). The planted outputs are `--planted encodes_twice` and
// `--planted skips_encode`; "the pass" is the one the frame's `passes` list says writes the final frame. At
// the base `deep-gpu` answers the view3d call with bad_input.
import { describe, expect, it } from 'vitest';
import {
  EV_UNIT, GPU_BIN, TONE_MAPS, fixturePath, frameAt, look, readLinear, readPng, requireGpu, runGpu, slotHashOf, toneProblems, useBins, useOut, view3d, view3Reply,
  type Planted, type ToneMap, type View3,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const SIZE: [number, number] = [512, 512];
const EXPOSURES = [EV_UNIT, EV_UNIT - 3];
const call = (map: ToneMap, ev: number) => view3d({ doc: fixturePath('grey-bands.json'), look: look({ tone_map: map, exposure: ev, finish: [], deband: 'none' }), size: SIZE, targets: ['final', 'linear'], capture: [0] });

/** The one pass that writes the final frame, as the reply lists the frame's passes. */
function outputPass(v: View3, what: string): string {
  const writers = v.passes.filter((p) => p.writes.includes('final'));
  expect(writers.map((p) => p.name), `${what}: exactly one pass writes the final frame`).toHaveLength(1);
  expect(v.passes.some((p) => p.reads.includes('linear')), `${what}: a pass reads the linear target`).toBe(true);
  return writers[0]!.name;
}

function compare(planted: Planted | undefined, map: ToneMap, ev: number) {
  const what = `${planted ?? 'the clean run'}, ${map} at EV100 ${ev.toFixed(4)}`;
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [call(map, ev)], planted ? { planted } : {});
  const v = view3Reply(reply!, what);
  const f = frameAt(v, 0, what);
  const final = readPng(out(), f.final, `${what}: the final frame`);
  expect(slotHashOf(final), `${what}: the final frame is the slot the frame's pixel_hash names`).toBe(f.pixel_hash);
  const linear = readLinear(out(), f.linear, SIZE, `${what}: the linear target`);
  // The linear target is the frame's own: each band's middle row is one grey, and the greys rise down the frame.
  const greys = Array.from({ length: 32 }, (_, k) => linear[((16 * k + 8) * SIZE[0] + 256) * 4]!);
  expect(greys.every((g, k) => k === 0 || g > greys[k - 1]!), `${what}: the bands' linear values rise from black to white: ${greys.map((g) => g.toFixed(4)).join(', ')}`).toBe(true);
  return { pass: outputPass(v, what), check: toneProblems(final, linear, map, ev, outputPass(v, what), what) };
}

describe('#378.a263a507 in a 3D writer layer under each tone map, with the finish at identity, every 8-bit pixel of the final frame equals within one code value the CPU\'s sRGB encoding of the look\'s exposure and tone map applied to the same frame\'s linear target read back; a planted output that encodes twice or not at all fails, naming the pass', () => {
  for (const map of TONE_MAPS) {
    it(`#378.a263a507 under ${map}, at both exposures, every pixel of the final frame is the CPU's sRGB encoding of exposure and ${map} applied to the linear target, within one code value`, () => {
      requireGpu();
      for (const ev of EXPOSURES) {
        const { check } = compare(undefined, map, ev);
        expect(check.checked, 'every pixel of the frame is compared').toBe(SIZE[0] * SIZE[1]);
        expect(check.problems, `${map} at EV100 ${ev}`).toEqual([]);
      }
    }, 600_000);
  }

  it('#378.a263a507 the fixture holds a linear 0.5 reaching the encode: under none at the unit exposure the 188 band\'s pixels are 188 in the clean run', () => {
    requireGpu();
    const { check } = compare(undefined, 'none', EV_UNIT);
    expect(check.at188.length, 'pixels whose tone-mapped linear value is 0.5 within 0.003').toBeGreaterThan(1000);
    expect(check.at188.filter((p) => p.read.some((c) => Math.abs(c - 188) > 1)).length, 'each reads 188').toBe(0);
  }, 600_000);

  for (const [planted, reads] of [['encodes_twice', 223], ['skips_encode', 128]] as const) {
    it(`#378.a263a507 a planted output that ${planted === 'encodes_twice' ? 'encodes twice' : 'doesn\'t encode'} (--planted ${planted}) reads ${reads} where a linear 0.5 reaches the encode, not 188, and fails, naming the pass`, () => {
      requireGpu();
      const { pass, check } = compare(planted, 'none', EV_UNIT);
      expect(check.at188.length, 'the 188 band is in the frame').toBeGreaterThan(1000);
      expect(check.at188.filter((p) => p.read.some((c) => Math.abs(c - reads) > 1)).length, `every pixel where a linear 0.5 reaches the encode reads ${reads}`).toBe(0);
      expect(check.problems.length, 'the comparison fails').toBe(1);
      expect(check.problems[0], 'the failure names the pass that writes the final frame').toContain(`pass ${pass}:`);
    }, 600_000);
  }
});

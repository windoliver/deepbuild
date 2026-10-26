// #380.639458be (the CPU references): every shipped pass operator matches its CPU reference within one
// 10-bit code value per channel on 99.9% of pixels on the same machine (the rest of the criterion, exact
// operators on two GPUs, is cts-exact.test.ts).
// The `reference` call runs one shipped operator on this machine's GPU and its CPU reference (reviewed test
// code, in f64) on the same inputs, read back from the frame the operator runs in, and writes the input and
// both outputs as f32 targets. Codes are 10-bit per channel: a linear output sRGB-encoded first, a
// display-referred one as it is (README: Readings). The tolerance, beside the issue's share, sets a ceiling
// for every pixel and a bound for any 16 × 16 window (technical design: every share also sets a ceiling
// and a window bound): helpers.ts TOLERANCE10. Each operator runs on its effect's scene, or on the scene
// with every effect on when it has none. A CPU reference counts as an oracle only once it reproduces a
// fixture whose expected numbers the issue or a formula gives and its planted twin fails (technical
// design), so the glow's and the grid's references, and their GPU operators, are also held to:
// - the glow (bloom with no threshold conserves energy): a uniform field passes unchanged;
// - the Karis average on the first downsample (each tap weighted by 1 / (1 + luma)): a firefly's halo
//   saturates with its brightness. Under it a lone pixel of 64 and one of 16 spread nearly the same light
//   (the weighted average tends to a third of the group as the pixel grows, about 1.06 to 1.25 between the
//   two, by where the taps fall); a plain average spreads four times as much for 64, so the ratio of their
//   halos must be at most 2; `--planted bloom_without_karis` drops it, on the GPU and in the reference;
// - the ground grid's lines thinner than a device pixel fade by their width: at 0.25 px each pixel the
//   1 px grid draws over the frame draws 0.25 of that, within 5%, and nothing where the 1 px grid draws
//   nothing.
// `--planted pass_off_by_two` moves every shipped pass operator's GPU output two 10-bit codes. At the base
// `deep-gpu` has no operators or reference call.
import { describe, expect, it } from 'vitest';
import {
  BLOOM, EFFECTS, GRID, OPERATORS, code10Problems, effectScene, expectNotBlank, look, operatorsReply, readF32, requireGpu, run1, shippedEffects, shown, srgbEncode,
  str, useBin, useOut, writeF32, writeJson, type F32, type Image, type JsonObject, type Operator, type Scene, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();

function shippedPasses(startup: Startup = {}): { passes: Operator[]; byEffect: Map<string, Operator> } {
  const ops = operatorsReply(run1(bins.bin(), out(), OPERATORS, startup));
  const byEffect = shippedEffects(ops, 'the operators call');
  return { passes: ops.filter((o) => o.origin === 'shipped' && o.kind === 'pass'), byEffect };
}
interface Ref { encoding: 'linear' | 'display'; input: F32; gpu: F32; cpu: F32 }
function reference(op: string, opts: { scene?: Scene; look?: JsonObject; size: [number, number]; input?: F32 }, startup: Startup = {}): Ref {
  const call: JsonObject = { call: 'reference', operator: op, look: opts.look ?? opts.scene?.look ?? look(), size: opts.size };
  if (opts.scene) { call['doc'] = writeJson(out(), `${op.replace(/\W/g, '_')}.json`, opts.scene.doc); call['selection'] = opts.scene.selection; }
  if (opts.input) call['input'] = { color: writeF32(out(), 'input', opts.input) };
  const reply = run1(bins.bin(), out(), call, startup);
  expect(reply['code'], `the reference call for ${op} was answered: ${shown(reply)}`).toBeUndefined();
  expect(reply['operator'], 'the reply is for the operator asked for').toBe(op);
  const encoding = str(reply['encoding'], 'reference: encoding');
  expect(['linear', 'display'], 'its output is linear or display-referred').toContain(encoding);
  const at = (k: string): F32 => readF32(out(), str(reply[k], `reference: ${k}`), opts.size, `${op}'s ${k}`);
  return { encoding: encoding as 'linear' | 'display', input: at('input'), gpu: at('gpu'), cpu: at('cpu') };
}
const lum = (img: F32, i: number): number => 0.2126 * img.rgba[i * 4]! + 0.7152 * img.rgba[i * 4 + 1]! + 0.0722 * img.rgba[i * 4 + 2]!;
function as8(img: F32, encoding: 'linear' | 'display'): Image {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.rgba.length; i++) rgba[i] = Math.round(255 * (i % 4 === 3 || encoding === 'display' ? Math.min(1, Math.max(0, img.rgba[i]!)) : srgbEncode(img.rgba[i]!)));
  return { width: img.width, height: img.height, rgba };
}
const field = (size: [number, number], bg: number, spot?: { at: [number, number]; value: number }): F32 => {
  const rgba = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < size[0] * size[1]; i++) rgba.set([bg, bg, bg, 1], i * 4);
  if (spot) rgba.set([spot.value, spot.value, spot.value, 1], (spot.at[1] * size[0] + spot.at[0]) * 4);
  return { width: size[0], height: size[1], rgba };
};

const FIELD: [number, number] = [256, 256];
const FIREFLY: [number, number] = [128, 128];
const BG = 0.02;
/** A firefly's halo: the light the output holds above the background, 2 to 48 px from it (Chebyshev). */
function halo(img: F32): number {
  let e = 0;
  for (let y = 0; y < FIELD[1]; y++) for (let x = 0; x < FIELD[0]; x++) {
    const d = Math.max(Math.abs(x - FIREFLY[0]), Math.abs(y - FIREFLY[1]));
    if (d >= 2 && d <= 48) e += Math.max(0, lum(img, y * FIELD[0] + x) - BG);
  }
  return e;
}
/** The bloom's formula fixtures, on one side's outputs; each problem names the side. */
function bloomProblems(side: string, uniform: Ref, bright: F32, dim: F32): string[] {
  const problems: string[] = [];
  const u = side === 'gpu' ? uniform.gpu : uniform.cpu;
  const c = Math.round(1023 * srgbEncode(0.25));
  let off = 0;
  for (let i = 0; i < FIELD[0] * FIELD[1]; i++) for (let k = 0; k < 3; k++) if (Math.abs(Math.round(1023 * srgbEncode(u.rgba[i * 4 + k]!)) - c) > 1) { off++; break; }
  if (off) problems.push(`${side}: the bloom moves ${off} pixels of a uniform 0.25 field by more than one 10-bit code (energy isn't conserved)`);
  const e64 = halo(bright); const e16 = halo(dim);
  if (!(e16 > 0.02)) problems.push(`${side}: a firefly of 16 spreads ${e16.toFixed(4)} of light around it, so the bloom doesn't spread light`);
  else if (!(e64 / e16 <= 2)) problems.push(`${side}: a firefly of 64 spreads ${(e64 / e16).toFixed(2)} times the light one of 16 does, more than 2: no Karis average on the first downsample`);
  return problems;
}

describe('#380.639458be every shipped pass operator matches its CPU reference within one 10-bit code value per channel on 99.9% of pixels on the same machine', () => {
  it('#380.639458be every shipped pass operator, on its effect\'s scene, matches its CPU reference within one 10-bit code per channel on 99.9% of pixels, none past 4 codes, no 16 × 16 window with more than 8 off', () => {
    requireGpu();
    const { passes, byEffect } = shippedPasses();
    for (const e of ['glow', 'outline', 'grid']) expect(passes.map((p) => p.name), `the ${e} effect is a shipped pass operator`).toContain(byEffect.get(e)!.name);
    const problems: string[] = [];
    for (const op of passes) {
      const scene = op.effect && (EFFECTS as readonly string[]).includes(op.effect) ? effectScene(op.effect as (typeof EFFECTS)[number]) : effectScene('all');
      const r = reference(op.name, { scene, size: [480, 360] });
      expectNotBlank(as8(r.gpu, r.encoding), `${op.name}'s GPU output`);
      let changed = 0;
      for (let i = 0; i < 480 * 360; i++) if (Math.abs(Math.round(1023 * srgbEncode(lum(r.cpu, i))) - Math.round(1023 * srgbEncode(lum(r.input, i)))) > 1) changed++;
      if (changed < 100) problems.push(`operator ${op.name}: its reference changes only ${changed} pixels of its scene, so the comparison can't see it work`);
      const c = code10Problems(r.gpu, r.cpu, r.encoding, op.name);
      console.log(`${op.name}: ${c.off} pixels off by more than one 10-bit code, worst ${c.worst}`);
      problems.push(...c.problems);
    }
    expect(problems, 'the shipped pass operators against their CPU references').toEqual([]);
  }, 3_600_000);

  it('#380.639458be the glow\'s reference and its GPU operator reproduce the formula\'s fixtures: a uniform field passes unchanged, and with the Karis average a firefly\'s halo doesn\'t grow with its brightness; a planted bloom without it (--planted bloom_without_karis) fails', () => {
    requireGpu();
    const glow = shippedPasses().byEffect.get('glow')!.name;
    const glowLook = look({ bloom: BLOOM });
    const sides = (startup: Startup = {}) => {
      const uniform = reference(glow, { look: glowLook, size: FIELD, input: field(FIELD, 0.25) }, startup);
      const bright = reference(glow, { look: glowLook, size: FIELD, input: field(FIELD, BG, { at: FIREFLY, value: 64 }) }, startup);
      const dim = reference(glow, { look: glowLook, size: FIELD, input: field(FIELD, BG, { at: FIREFLY, value: 16 }) }, startup);
      expect(uniform.encoding, 'the glow runs in the effects chain, in linear light').toBe('linear');
      return [...bloomProblems('gpu', uniform, bright.gpu, dim.gpu), ...bloomProblems('cpu', uniform, bright.cpu, dim.cpu)];
    };
    expect(sides(), 'the glow on the formula\'s fixtures, GPU and CPU reference').toEqual([]);
    expect(sides({ planted: 'bloom_without_karis' }).join('\n'), 'the planted bloom without the Karis average fails the firefly fixture').toMatch(/no Karis average on the first downsample/);
  }, 1_800_000);

  it('#380.639458be the ground grid\'s reference and its GPU operator fade a line thinner than a device pixel by its width: at 0.25 px each pixel draws 0.25 of what the 1 px grid draws there, within 5%, and nothing more', () => {
    requireGpu();
    const grid = shippedPasses().byEffect.get('grid')!.name;
    const at = (width: number): Ref => reference(grid, { scene: { ...effectScene('grid'), look: look({ ground_3d: { ...GRID, width } }) }, size: [480, 360] });
    const one = at(1); const quarter = at(0.25);
    for (const side of ['gpu', 'cpu'] as const) {
      const a = one[side]; const q = quarter[side];
      let strong = 0; let inside = 0; let sumOne = 0; let sumQuarter = 0; let spread = 0;
      for (let i = 0; i < 480 * 360; i++) {
        const d1 = lum(a, i) - lum(one.input, i); const dq = lum(q, i) - lum(quarter.input, i);
        if (d1 >= 0.05) { strong++; sumOne += d1; sumQuarter += dq; if (Math.abs(dq / d1 - 0.25) <= 0.0125) inside++; }
        if (d1 < 0.002 && dq > 0.005) spread++;
      }
      expect(strong, `${side}: the 1 px grid draws lines on at least 500 pixels`).toBeGreaterThanOrEqual(500);
      expect(inside / strong, `${side}: the share of the 1 px grid's line pixels where the 0.25 px grid draws 0.25 of it, within 5%`).toBeGreaterThanOrEqual(0.95);
      expect(Math.abs(sumQuarter / sumOne - 0.25), `${side}: the 0.25 px grid's light over the 1 px grid's (${(sumQuarter / sumOne).toFixed(4)}) is 0.25 within 5%`).toBeLessThanOrEqual(0.0125);
      expect(spread, `${side}: pixels the 0.25 px grid draws where the 1 px grid draws nothing (it spreads)`).toBe(0);
    }
  }, 1_800_000);

  it('#380.639458be a planted GPU pass two 10-bit codes off its CPU reference (--planted pass_off_by_two) fails, naming the operator', () => {
    requireGpu();
    const glow = shippedPasses({ planted: 'pass_off_by_two' }).byEffect.get('glow')!.name;
    const r = reference(glow, { scene: effectScene('glow'), size: [480, 360] }, { planted: 'pass_off_by_two' });
    const c = code10Problems(r.gpu, r.cpu, r.encoding, glow);
    expect(c.problems.length, 'the comparison fails').toBeGreaterThan(0);
    expect(c.problems[0], 'naming the operator').toContain(`operator ${glow}:`);
  }, 1_800_000);
});

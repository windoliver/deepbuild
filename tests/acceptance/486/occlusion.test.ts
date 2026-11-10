// AC2 #486.f7c1ed7f: occlusion darkens only what ambient occlusion darkens: on a plate under a sun and a studio
// environment, with the look's ao off and an emissive square on the plate, an operator that writes occlusion 0
// everywhere matches within one 10-bit code value the same plate with the environment's lighting and the probes
// removed, the square keeping its emission, and one that writes 1 matches the plate with no operator; a planted occlusion
// that also scales direct light or emission darkens the sunlit plate or the square and fails, naming the pixel.
//
// The plate (helpers: `occlusionDoc`): a 1 m stone plate (0.6 grey, roughness 0.5) and on it a 30 cm square, dark, its
// emission [1, 0.5, 0.125] × 4; lit by a sun of 3 lx and the shipped studio environment, inside a reflection probe's box;
// the look's ao off (`ao: none`), at 512 × 512. With an operator, both parts' materials name `occ`, which writes
// occlusion 0 (or 1) everywhere. The references: the same plate and square with no operator, with the environment and the
// probe removed (a black sky with no ambient: the sun is the only light), or with both kept. Judged on the linear target:
// every pixel of the plate or the square, 2 px inside that part in both frames; every one within one 10-bit code value
// (|got − want| × 1023 ÷ max(1, |want|)) in each channel, at least 20,000 judged. The fixture holds only where the
// environment lights the plate: with it, at least 90% of the plate's judged pixels read more than one code above the
// plate without it, so occlusion 0 can't match by doing nothing.
// 1. Occlusion 0 against the plate without the environment and the probe; occlusion 1 against the plate with no operator.
// 2. `--planted occlusion_scales_direct` (the output also scales the direct light and the emission): occlusion 0 fails,
//    each failure naming its pixel, at least one darker than the reference on the sunlit plate or the square.
// Wrong programs: the base (the output refused, the environment left on); an occlusion that leaves the environment's
// specular or the probe's light; one that scales the sun's light or the emission.
import { describe, expect, it } from 'vitest';
import { AC, draw, lum, nameOff, none, offPixels, occlusionDoc, requireMetal, samePartPixels, useDir, useGpu, worstCodes, type Drawn, type Off } from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();

/** `got` against `want` on the plate's and the square's pixels: each pixel off by more than one code, named. */
function compare(got: Drawn, want: Drawn): { failures: string[]; off: Off[]; judged: number } {
  const px = samePartPixels(got, want, ['plate', 'square'], 2);
  const off = offPixels(got, want, px).sort((a, b) => b.codes - a.codes);
  console.log(`${ID}: ${got.name} against ${want.name}: ${off.length} of ${px.length} judged pixels more than one code off`);
  const failures = px.length < 20_000 ? [`${got.name}: only ${px.length} pixels of the plate and the square judged (20,000 needed)`] : [];
  failures.push(...off.map((o) => `${got.name}: ${nameOff(o)}, as ${want.name} reads it`));
  return { failures, off, judged: px.length };
}

describe(`${ID} occlusion scales only the ambient, probe and environment light`, () => {
  it(`${ID} occlusion 0 everywhere matches the plate without the environment's lighting and the probe, the square keeping its emission, and occlusion 1 matches the plate with no operator, within one 10-bit code`, () => {
    requireMetal();
    const [zero, without, one, plain] = draw(bin(), dir(), [
      { name: 'occlusion 0', doc: occlusionDoc('occlusion-0', true, 0) },
      { name: 'the plate without the environment and the probe', doc: occlusionDoc('no-environment', false, null) },
      { name: 'occlusion 1', doc: occlusionDoc('occlusion-1', true, 1) },
      { name: 'the plate with no operator', doc: occlusionDoc('no-operator', true, null) },
    ]) as [Drawn, Drawn, Drawn, Drawn];
    const lit = samePartPixels(plain, without, ['plate'], 2);
    const brighter = lit.filter((p) => worstCodes(plain.linear.at(p.x, p.y), without.linear.at(p.x, p.y)) > 1 && lum(plain.linear.at(p.x, p.y)) > lum(without.linear.at(p.x, p.y))).length;
    console.log(`${ID}: the environment lights ${brighter} of ${lit.length} plate pixels by more than one code`);
    expect(brighter, 'the fixture: the environment lights at least 90% of the plate by more than one code').toBeGreaterThanOrEqual(0.9 * lit.length);
    none([...compare(zero, without).failures, ...compare(one, plain).failures], 'occlusion 0 and 1 against their references');
  }, 3_600_000);

  it(`${ID} a planted occlusion that also scales direct light and emission (--planted occlusion_scales_direct) darkens the sunlit plate or the square and fails, naming the pixel`, () => {
    requireMetal();
    const [zero, without] = draw(bin(), dir(), [
      { name: 'occlusion 0', doc: occlusionDoc('occlusion-0', true, 0) },
      { name: 'the plate without the environment and the probe', doc: occlusionDoc('no-environment', false, null) },
    ], 'occlusion_scales_direct') as [Drawn, Drawn];
    const r = compare(zero, without);
    expect(r.failures.length, '--planted occlusion_scales_direct fails this check').toBeGreaterThan(0);
    console.log(`${ID}: --planted occlusion_scales_direct: ${r.failures.slice(0, 3).join('; ')}`);
    expect(r.failures.some((f) => /pixel \(\d+, \d+\) on (plate|square)/.test(f)), `a failure names its pixel: ${r.failures.slice(0, 5).join('; ')}`).toBe(true);
    expect(r.off.some((o) => lum(o.got) < lum(o.want)), 'the planted occlusion darkens the sunlit plate or the square').toBe(true);
  }, 3_600_000);
});

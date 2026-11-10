// AC1 #486.fccdc529: A material operator writes a lobe per pixel: on a plate whose material has coat 0.5, an operator
// that writes coat 1 where uv0.u < 0.5 and 0 elsewhere matches, within one 10-bit code value per channel on 99.9% of
// pixels on one machine, the same plate drawn with coat 1 on its left half and with coat 0 on its right, away from the
// one-pixel column at the split; a written coat of 1.5 draws as coat 1; and a planted output that scales the material's
// coat instead of replacing it draws the left half at coat 0.5 and fails, naming the operator.
//
// The plate (helpers: `coatOpDoc`): a 1 m `mark.box@1` facing the camera, uv0 across it with u along +x, its material
// `coated` a red dielectric with coat 0.5 (coat roughness 0.08) naming the operator; lit by a sun (2 lx) and the shipped
// studio environment, so the coat shows on every pixel as reflection and as the base it dims; seen from below its centre
// at 512 × 512, the split u = 0.5 on x = 0, the frame's centre line. The reference (`coatHalvesDoc`) is the same plate
// as two 0.5 m halves with no operator, `left` at coat 1 and `right` at coat 0. Judged on the linear target: every pixel
// where the operator's plate and the halves both draw, 1 px inside their outline, except the two columns within one
// pixel of the split; at most 0.1% of them more than one 10-bit code value off in some channel (#429's reading:
// |got − want| × 1023 ÷ max(1, |want|)), and at least 10,000 judged.
// 1. `coat_split` (1 left, 0 right) and `coat_split_15` (1.5 left, 0 right) each against the halves at 1 and 0.
// 2. `--planted lobe_output_scales_field` (the output multiplies the material's coat instead of replacing it): the same
//    check fails naming `coat_split`, and its left half matches the halves at coat 0.5 and 0 there.
// Wrong programs: the base (the output refused, the plate drawn at its own 0.5 everywhere); an output scaled by the
// field; a written value left unclamped; an output read per part instead of per pixel; a split by another coordinate.
import { describe, it } from 'vitest';
import {
  AC, SPLIT_SIZE, atSplit, coatHalvesDoc, coatOpDoc, draw, failsNaming, judgedPixels, nameOff, none, offPixels, requireMetal, useDir, useGpu,
  type Drawn,
} from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();

/** The operator's frame against the halves', over every judged pixel or one side's: failures naming the operator. */
function matchHalves(op: Drawn, halves: Drawn, operator: string, side?: 'left' | 'right'): string[] {
  let px = judgedPixels(op, ['plate'], halves, ['left', 'right'], 1, atSplit);
  if (side) px = px.filter((p) => (p.x + 0.5 < SPLIT_SIZE[0] / 2) === (side === 'left'));
  const off = offPixels(op, halves, px).sort((a, b) => b.codes - a.codes);
  console.log(`${ID}: ${operator} against ${halves.name}${side ? ` (${side} half)` : ''}: ${off.length} of ${px.length} judged pixels more than one code off`);
  const out = px.length < 10_000 ? [`${operator}: only ${px.length} plate pixels judged against ${halves.name} (10,000 needed)`] : [];
  if (off.length > 0.001 * px.length) out.push(`${operator}: ${off.length} of ${px.length} plate pixels (more than 0.1%) differ from ${halves.name} by more than one 10-bit code value; the worst, ${nameOff(off[0]!)}`);
  return out;
}

describe(`${ID} a material operator writes the coat per pixel`, () => {
  it(`${ID} on a coat-0.5 plate, coat 1 written where uv0.u < 0.5 and 0 elsewhere matches the plate drawn as halves at coat 1 and 0 within one 10-bit code on 99.9% of pixels away from the split, and a written 1.5 draws as 1`, () => {
    requireMetal();
    const [one, oneHalf, halves] = draw(bin(), dir(), [
      { name: 'coat_split', doc: coatOpDoc('coat-split', 'coat_split', 1, 0) },
      { name: 'coat_split_15', doc: coatOpDoc('coat-split-15', 'coat_split_15', 1.5, 0) },
      { name: 'halves at coat 1 and 0', doc: coatHalvesDoc('halves-1-0', 1, 0) },
    ]) as [Drawn, Drawn, Drawn];
    none([...matchHalves(one, halves, 'coat_split'), ...matchHalves(oneHalf, halves, 'coat_split_15')], 'the per-pixel coat against the halves');
  }, 3_600_000);

  it(`${ID} a planted output that scales the material's coat instead of replacing it (--planted lobe_output_scales_field) draws the left half at coat 0.5 and fails, naming the operator`, () => {
    requireMetal();
    const [one, halves, halfCoat] = draw(bin(), dir(), [
      { name: 'coat_split', doc: coatOpDoc('coat-split', 'coat_split', 1, 0) },
      { name: 'halves at coat 1 and 0', doc: coatHalvesDoc('halves-1-0', 1, 0) },
      { name: 'halves at coat 0.5 and 0', doc: coatHalvesDoc('halves-05-0', 0.5, 0) },
    ], 'lobe_output_scales_field') as [Drawn, Drawn, Drawn];
    failsNaming(matchHalves(one, halves, 'coat_split'), ['coat_split'], '--planted lobe_output_scales_field');
    none(matchHalves(one, halfCoat, 'coat_split', 'left'), '--planted lobe_output_scales_field draws the left half at coat 0.5');
  }, 3_600_000);
});

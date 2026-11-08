// #464.93ecbe88: "Grade: a color decision list of slope (1.2, 1, 0.8), offset (0.02, 0, −0.02), power (0.9, 1, 1.1) and
// saturation 0.8 matches the ASC CDL reference computed in f64 within one 10-bit code value at 64 sampled pixels, and
// white balance at 6,500 K with tint 0 changes no pixel"
//
// The grade runs inside the tone-mapping pass (Look look@1: grade), so it is read through #418's `tone` call, which runs
// that pass on this GPU over an f32 image, with one field added, `grade`. The 64 sampled pixels are an 8 × 8 image of
// display-linear colors drawn from a seeded generator (seed 464) in [0, 1]; under tone map none each output must lie
// within one 10-bit code value (sRGB-encoded, × 1023) of the ASC CDL computed here in f64: clamp(in × slope + offset)
// raised to power, then saturation about Rec. 709 luma, clamped to [0, 1] (#418's reading). White balance: #382's film
// (no status binding) drawn by `view3d` with `grade: {white_balance: {temperature: 6500, tint: 0}}` has the pixel hash of
// the film with no grade, and at 5,000 K it doesn't, so the field is read. Wrong programs: a grade the pass ignores; a
// CDL in another order or about another luma; a white balance whose 6,500 K isn't the identity.
import { describe, expect, it } from 'vitest';
import {
  AC, FILM_ROLES, type JsonObject, Lcg, type Lin, answered, clamp01, film3d, frameAt, look3d, luma, none, readF32, requireGpu, runGpu, srgbEncode, useBins, useOut, writeF32, writeJson,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const CDL = { slope: [1.2, 1, 0.8], offset: [0.02, 0, -0.02], power: [0.9, 1, 1.1], saturation: 0.8 };

function reference(c: Lin): Lin {
  const o = c.map((v, i) => clamp01(v * CDL.slope[i]! + CDL.offset[i]!) ** CDL.power[i]!) as Lin;
  const y = luma(o);
  return o.map((v) => clamp01(y + CDL.saturation * (v - y))) as Lin;
}

describe(`${AC[14]} the grade held to the ASC CDL in f64, and white balance at 6,500 K as the identity`, () => {
  it(`${AC[14]} the color decision list matches the ASC CDL reference computed in f64 within one 10-bit code value at 64 sampled pixels`, () => {
    requireGpu();
    const dir = out();
    const rng = new Lcg(464);
    const rgba = new Float32Array(64 * 4);
    for (let i = 0; i < 64; i++) { for (let c = 0; c < 3; c++) rgba[i * 4 + c] = rng.next(); rgba[i * 4 + 3] = 1; }
    const input = writeF32(dir, 'samples.f32', rgba);
    const [r] = runGpu(bins.bin('deep-gpu'), dir, [{ call: 'tone', tone_map: 'none', grade: { white_balance: { temperature: 6500, tint: 0 }, ...CDL }, input, size: [8, 8] }]);
    const output = readF32(dir, answered(r!, 'the graded samples')['output'], [8, 8], 'the graded samples');
    const problems: string[] = [];
    for (let i = 0; i < 64; i++) {
      const inp = [0, 1, 2].map((c) => rgba[i * 4 + c]!) as Lin;
      const want = reference(inp);
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(srgbEncode(output.rgba[i * 4 + c]!) - srgbEncode(want[c]!)) * 1023;
        if (d > 1) problems.push(`sample ${i} (${inp.map((v) => v.toFixed(4)).join(', ')}) channel ${c}: ${output.rgba[i * 4 + c]!.toFixed(5)} where the CDL gives ${want[c]!.toFixed(5)}, ${d.toFixed(2)} 10-bit codes apart`);
      }
    }
    none(problems, `${AC[14]} the CDL`);
  });

  it(`${AC[14]} white balance at 6,500 K with tint 0 changes no pixel`, () => {
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'film.json', film3d('film-grade-464', false));
    const call = (grade?: JsonObject): JsonObject => ({ call: 'view3d', doc, look: look3d('grade-464', FILM_ROLES, grade ? { grade } : {}), size: [480, 360], targets: ['final'], capture: [0] });
    const [plain, d65, warm] = runGpu(bins.bin('deep-gpu'), dir, [
      call(), call({ white_balance: { temperature: 6500, tint: 0 } }), call({ white_balance: { temperature: 5000, tint: 0 } }),
    ]).map((reply, i) => frameAt(reply, 0, ['no grade', 'white balance 6500 K', 'white balance 5000 K'][i]!));
    expect(d65!.pixel_hash, 'white balance at 6,500 K, tint 0, draws the frame with no grade').toBe(plain!.pixel_hash);
    expect(warm!.pixel_hash, 'white balance at 5,000 K changes the frame, so the field is read').not.toBe(plain!.pixel_hash);
  });
});

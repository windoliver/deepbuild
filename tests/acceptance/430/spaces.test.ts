// AC4 #430.f859c44c: In a 2D writer layer, a group pass that halves each channel turns an opaque fill of sRGB 200 into
// 100, since passes there see sRGB-encoded values as blend modes do; in a 3D writer layer the same pass halves linear
// light, so a fill that reaches it at linear 0.578 (sRGB 200) leaves it at 0.289, which encodes as sRGB 146.
//
// The same document, with no 3D item and with a camera, a box and a sun beside the fill (helpers.ts: fillDoc), drawn by
// the GPU layer through `layers` (#385's), with the role map look's no tone map and unit exposure. The interior of the
// fill is read as written: PNG codes exactly, and in the 3D layer the f32 file's linear light (`float`, README) to the
// three digits the criterion gives. Without the pass the same pixels read 200 and 0.578, which is the fill "reaching
// it" there. At the base the check refuses `passes`.
import { describe, expect, it } from 'vitest';
import { AC, FILL_BOX, LOOK, fillDoc, floatsOf, fx, grown, layerOf, layersCall, px, readLayers, requireMetal, runGpu, useDir, useGpu, type LayerDrawn, type Planted } from './helpers.ts';
import { toEncoded, toLinear } from './reference.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const SIZE = [240, 160] as const;

function drawn(three: boolean, halve: boolean, planted?: Planted): LayerDrawn {
  const out = dir();
  const [r] = runGpu(bin(), out, [layersCall(fillDoc(three, halve), LOOK, { float: true })], planted);
  return layerOf(readLayers(out, r!, SIZE, `the fill, ${three ? '3D' : '2D'}, ${halve ? 'halved' : 'plain'}`), 'main', 'the fill');
}

/** Every interior pixel's PNG code, as a set; the fill is one color, so one entry is what the criterion says. */
function codesOf(l: LayerDrawn): string[] {
  const [x0, y0, w, h] = grown(FILL_BOX, -4);
  const seen = new Set<string>();
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) seen.add(JSON.stringify(px(l.image, x, y)));
  return [...seen];
}
/** The fill's interior centre in the f32 file. */
function linearOf(l: LayerDrawn): number[] {
  const x = FILL_BOX[0] + FILL_BOX[2] / 2; const y = FILL_BOX[1] + FILL_BOX[3] / 2;
  return fx(floatsOf(l, 'the 3D layer'), x, y).map((v) => Math.round(v * 1000) / 1000);
}

describe(`${ID} a pass sees the space its writer layer composites in`, () => {
  it(`${ID} in a 2D writer layer the pass turns sRGB 200 into 100; in a 3D writer layer 0.578 into 0.289, which encodes as sRGB 146`, () => {
    // The criterion's numbers, from the sRGB curve.
    expect(Math.round(toLinear(200 / 255) * 1000) / 1000, 'sRGB 200 is linear 0.578').toBe(0.578);
    expect(Math.round((toLinear(200 / 255) / 2) * 1000) / 1000, 'half of it is 0.289').toBe(0.289);
    expect(Math.round(toEncoded(toLinear(200 / 255) / 2) * 255), 'which encodes as sRGB 146').toBe(146);
    requireMetal();
    const plain2 = drawn(false, false); const half2 = drawn(false, true);
    expect(half2.dim, 'no 3D item: a 2D writer layer').toBe('2d');
    expect(half2.path, 'a 2D writer layer with passes moves to the GPU layer').toBe('gpu_layer');
    expect(codesOf(plain2), 'the opaque fill with no pass').toEqual([JSON.stringify([200, 200, 200, 255])]);
    expect(codesOf(half2), 'the pass halves sRGB-encoded values: 200 into 100').toEqual([JSON.stringify([100, 100, 100, 255])]);

    const plain3 = drawn(true, false); const half3 = drawn(true, true);
    expect(half3.dim, 'with a box in it: a 3D writer layer').toBe('3d');
    expect(codesOf(plain3), 'the fill reaches the pass as sRGB 200').toEqual([JSON.stringify([200, 200, 200, 255])]);
    expect(linearOf(plain3).slice(0, 3), 'which is linear 0.578').toEqual([0.578, 0.578, 0.578]);
    expect(linearOf(half3).slice(0, 3), 'the pass halves linear light: 0.289').toEqual([0.289, 0.289, 0.289]);
    expect(codesOf(half3), 'which encodes as sRGB 146').toEqual([JSON.stringify([146, 146, 146, 255])]);
  }, 1_800_000);

  it(`${ID} planted: a pass in linear light in a 2D layer reads 146, and one on encoded values in a 3D layer reads 100`, () => {
    requireMetal();
    expect(codesOf(drawn(false, true, 'pass_linear_in_2d')), 'pass_linear_in_2d').toEqual([JSON.stringify([146, 146, 146, 255])]);
    expect(codesOf(drawn(true, true, 'pass_encoded_in_3d')), 'pass_encoded_in_3d').toEqual([JSON.stringify([100, 100, 100, 255])]);
  }, 1_800_000);
});

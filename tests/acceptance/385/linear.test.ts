// Criterion 6: a writer layer that holds a 3D object and a title is a 3D writer layer: a multiply group around the
// title blends in linear light, while the same group in a layer with no 3D item blends in sRGB-encoded space.
//
// The figure (helpers.ts `titleDoc`): a backdrop plate of sRGB (51, 128, 200) and, in a multiply group around the
// title, the title's plate of (51, 26, 100) with the title on it; the 3D twin adds a camera, a sun and a box to the
// same writer layer. Read on the title's plate away from its glyphs. Multiplying in linear light and in encoded space
// differ there by 6 and 5 codes in red and green, which the test checks of its own numbers first. The 3D layer is
// drawn by the GPU layer, the 2D one by Vello CPU and by Vello GPU, through `deep-gpu run`'s `layers` (README), whose
// reply names each layer's dimension. The role map look has no tone map and unit exposure, so the 3D layer encodes
// what it blends with the sRGB curve alone. At the base `deep-gpu` has no `layers` call.
import { describe, expect, it } from 'vitest';
import {
  DEEP_GPU, LOOK, TITLE_PLATE, TITLE_TEXT, gpuReplies, layersCall, needsMac, obj, px, readLayers, sideOf, titleDoc, toEncoded, toLinear,
  useBuilds, useDir, type Image,
} from './helpers.ts';

const builds = useBuilds([DEEP_GPU]);
const dir = useDir('deep-385-linear-');
const roles = obj(LOOK['light'], 'light');
const BACK = roles['back'] as number[]; const SRC = roles['src'] as number[];
const encoded = BACK.map((b, i) => Math.round((b * SRC[i]!) / 255));
const linear = BACK.map((b, i) => Math.round(255 * toEncoded(toLinear(b / 255) * toLinear(SRC[i]! / 255))));

/** The title's plate above its text, 2 px in: every pixel within one code of `want`, else the first that isn't. */
function plateProblems(image: Image, want: number[], who: string): string[] {
  const [x0, y0, w] = TITLE_PLATE;
  const yEnd = TITLE_TEXT[1] - 2;
  for (let y = y0 + 2; y < yEnd; y++) for (let x = x0 + 2; x < x0 + w - 2; x++) {
    const p = px(image, x, y).slice(0, 3);
    if (p.some((v, i) => Math.abs(v - want[i]!) > 1)) return [`${who}: the title's plate at (${x}, ${y}) is ${JSON.stringify(p)}, not ${JSON.stringify(want)} within one code`];
  }
  return [];
}

describe('C6 a multiply group around a title: linear light in a 3D writer layer, sRGB-encoded in a 2D one', () => {
  it('C6 in the layer with a box, the layer is 3D and the group blends in linear light; in the layer without, it is 2D and blends in sRGB-encoded space', () => {
    // The fixture tells the two spaces apart: at least two channels more than one code apart.
    expect(encoded.filter((v, i) => Math.abs(v - linear[i]!) > 1).length, `multiply in encoded space ${JSON.stringify(encoded)} against linear light ${JSON.stringify(linear)}`).toBeGreaterThanOrEqual(2);
    needsMac();
    const out = dir();
    const [three, two] = gpuReplies(builds.bin(DEEP_GPU), out, [
      layersCall(titleDoc(true), LOOK, ['gpu_layer']), layersCall(titleDoc(false), LOOK, ['vello_cpu', 'gpu_layer']),
    ]);
    const l3 = readLayers(out, three!, 'title-3d').get('main');
    const l2 = readLayers(out, two!, 'title-2d').get('main');
    expect(l3?.dim, 'a writer layer that holds a 3D object and a title is a 3D writer layer').toBe('3d');
    expect(l2?.dim, 'the same layer with no 3D item is a 2D writer layer').toBe('2d');
    const found = [
      ...plateProblems(sideOf(l3, 'gpu_layer', 'title-3d').image, linear, 'the 3D layer'),
      ...plateProblems(sideOf(l2, 'vello_cpu', 'title-2d').image, encoded, 'the 2D layer by Vello CPU'),
      ...plateProblems(sideOf(l2, 'gpu_layer', 'title-2d').image, encoded, 'the 2D layer by Vello GPU'),
    ];
    expect(found, `linear light ${JSON.stringify(linear)} in 3D, encoded ${JSON.stringify(encoded)} in 2D`).toEqual([]);
  }, 1_800_000);
});

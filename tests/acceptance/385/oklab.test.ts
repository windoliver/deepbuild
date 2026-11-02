// Criterion 3: an OKLab gradient from black to a grey of sRGB 0.2 (code 51) reads 13 at its midpoint in Vello CPU, in
// Vello GPU and in GPUI's exact gradient mode, and a horizontal gradient's rows are identical in each (a 2.2 power curve
// reads 20 and GPUI's own dither moves pixels by up to two code values).
//
// Vello CPU is `deep-canvas-render raster`; GPUI's exact mode is `deep-canvas-render render`, GPUI's frame path, which
// draws two-stop gradients through the GPUI patch's exact mode; Vello GPU is `deep-gpu run`'s `layers` by the GPU
// layer. The figure is 257 px wide, so column 128's centre is the gradient's midpoint. The wrong program the parenthesis
// names is the base's `render` planted `gpui_oklab_gradient` (GPUI's own OKLab option: its dither and 2.2 curve), which
// the same measure must fail. At the base `deep-gpu` has no `layers` call.
import { describe, expect, it } from 'vitest';
import {
  DEEP_GPU, LOOK, RENDER, answers, drawLine, gpuReplies, layersCall, linearToOklab, needsMac, oklabDoc, oklabToLinear, px, readDrawn, readLayers,
  sideOf, toEncoded, toLinear, useBuilds, useDir, type Image,
} from './helpers.ts';

const builds = useBuilds([RENDER, DEEP_GPU]);
const dir = useDir('deep-385-oklab-');
const MID = 128;

/** What the measure finds wrong with a drawing of the figure: the midpoint's reading and any row that differs from row 0. */
function problems(image: Image, who: string): string[] {
  const p: string[] = [];
  const bad = [...Array(image.height).keys()].filter((y) => JSON.stringify(px(image, MID, y).slice(0, 3)) !== '[13,13,13]');
  if (bad.length) p.push(`${who}: the midpoint (column ${MID}) reads ${JSON.stringify(px(image, MID, bad[0]!).slice(0, 3))} in row ${bad[0]}, not 13 (${bad.length} rows)`);
  const row0 = image.rgba.subarray(0, image.width * 4);
  const differing = [...Array(image.height).keys()].filter((y) => !Buffer.from(image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4)).equals(Buffer.from(row0)));
  if (differing.length) {
    const y = differing[0]!;
    let most = 0;
    for (let x = 0; x < image.width; x++) for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(px(image, x, y)[c]! - px(image, x, 0)[c]!));
    p.push(`${who}: ${differing.length} rows differ from row 0 (row ${y} by up to ${most} codes)`);
  }
  return p;
}

describe('C3 an OKLab gradient from black to grey 51', () => {
  it('C3 reads 13 at its midpoint with identical rows in Vello CPU, in Vello GPU and in GPUI\'s exact gradient mode, and GPUI\'s own OKLab option fails the same measure', () => {
    // The expected values, from the conventions: OKLab puts 13 at the midpoint; a 2.2 power curve both ways puts 20.
    const mid = oklabToLinear(linearToOklab([0.2, 0.2, 0.2].map(toLinear) as [number, number, number]).map((v) => v / 2) as [number, number, number]);
    expect(Math.round(255 * toEncoded(mid[0]!)), 'the sRGB curve, OKLab midpoint').toBe(13);
    const viaPower = oklabToLinear(linearToOklab([0.2 ** 2.2, 0.2 ** 2.2, 0.2 ** 2.2]).map((v) => v / 2) as [number, number, number]);
    expect(Math.round(255 * viaPower[0]! ** (1 / 2.2)), 'a 2.2 power curve both ways').toBe(20);
    needsMac();
    const d = dir();
    const found: string[] = [];
    const cpu = drawLine(d, oklabDoc(), LOOK);
    found.push(...problems(readDrawn(cpu, answers(builds.bin(RENDER), ['raster'], [cpu])[0]!, 'Vello CPU').image, 'Vello CPU'));
    const exact = drawLine(d, oklabDoc(), LOOK);
    const own = drawLine(d, oklabDoc(), LOOK, { planted: 'gpui_oklab_gradient' });
    const [ea, oa] = answers(builds.bin(RENDER), ['render'], [exact, own]);
    found.push(...problems(readDrawn(exact, ea!, 'GPUI exact').image, 'GPUI\'s exact gradient mode'));
    const [reply] = gpuReplies(builds.bin(DEEP_GPU), d, [layersCall(oklabDoc(), LOOK, ['gpu_layer'])]);
    found.push(...problems(sideOf(readLayers(d, reply!, 'oklab').get('main'), 'gpu_layer', 'oklab').image, 'Vello GPU'));
    expect(found, 'each renderer reads 13 at the midpoint, every row the same').toEqual([]);
    const wrong = problems(readDrawn(own, oa!, 'GPUI\'s own OKLab option').image, 'GPUI\'s own OKLab option');
    expect(wrong.length, 'GPUI\'s own OKLab option (its 2.2 curve and dither) fails the measure').toBeGreaterThan(0);
  }, 1_800_000);
});

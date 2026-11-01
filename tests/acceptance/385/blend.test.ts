// Criterion 2: each W3C mode and add on a group, blended over a ramp, matches its W3C Compositing and Blending formula
// applied in f64 to the same 8-bit premultiplied inputs within one 8-bit code value on 99.9% of pixels in Vello CPU
// goldens; Vello GPU matches those goldens within one code value, within six for color dodge and within two for color
// burn, as Vello's own snapshot suite holds them; a blended group never changes another writer's layer, the card or a
// status color.
//
// The goldens are `deep-canvas-render raster` (Vello CPU). The inputs are the ones the renderer composites, written by
// `raster`'s `blend_inputs` (README) and checked here before use: the backdrop against the same figure drawn without
// the group, the source the same bytes in every mode (and right by the normal mode's formula). The formula is
// helpers.ts's `blendPixel`. Vello GPU is `deep-gpu run`'s `layers` by the GPU layer; the card and the live status
// mark are `deep-gpu run`'s `window2d`. The scene is Vello's mix scene (vello_tests/tests/mix.rs at 235739c4f0): a
// five-stop gradient at alpha 0.86 over a ramp, ported (our ramps interpolate in OKLab, so Vello's PNGs can't be fed
// our output; its tolerances are the issue's). At the base the check refuses `blend`, and `deep-gpu` has neither call.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CARD, CARD_RECT, DEEP_GPU, GATE_BOX, GPU_CODES, LOOK, MODES, RENDER, STATES, acrossDoc, answers, arr, blendDoc, blendPixel, decodePng, diff,
  drawLine, gpuReplies, layersCall, needsMac, obj, outPng, over, premul8To01, px, readDrawn, readLayers, sideOf, statusDoc, str, straight8,
  useBuilds, useDir, within, type Image, type Mode, type Rgba,
} from './helpers.ts';

const builds = useBuilds([RENDER, DEEP_GPU]);
const dir = useDir('deep-385-blend-');

interface Golden { image: Image; backdrop: Image; source: Image }

/** Draws the backdrop alone and the group in each mode with `blend_inputs`, in one `raster` process. */
function goldens(): { alone: Image; byMode: Map<Mode, Golden> } {
  const d = dir();
  const lines = [drawLine(d, blendDoc('normal', { group: false }), LOOK)];
  for (const m of MODES) {
    const inputs = join(d, `inputs-${m}`);
    mkdirSync(inputs);
    lines.push(drawLine(d, blendDoc(m), LOOK, { blend_inputs: inputs }));
  }
  const out = answers(builds.bin(RENDER), ['raster'], lines);
  const alone = readDrawn(lines[0]!, out[0]!, 'the backdrop alone').image;
  const byMode = new Map<Mode, Golden>();
  for (const [i, m] of MODES.entries()) {
    const drawn = readDrawn(lines[i + 1]!, out[i + 1]!, `the group in ${m}`);
    const list = arr(drawn.report['blend_inputs'], `${m}: blend_inputs`).map((v) => obj(v, `${m}: blend_inputs[]`));
    expect(list.map((e) => [e['group'], e['mode']]), `${m}: one blended group, mix, in ${m}`).toEqual([['mix', m]]);
    const e = list[0]!;
    byMode.set(m, { image: drawn.image, backdrop: decodePng(readFileSync(str(e['backdrop'], 'backdrop'))), source: decodePng(readFileSync(str(e['source'], 'source'))) });
  }
  return { alone, byMode };
}

/** The formula over every pixel, as the straight 8-bit RGBA the golden holds (the ramp is opaque, so the result is). */
function expected(mode: Mode, g: Golden): Image {
  const { width, height } = g.backdrop;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(straight8(blendPixel(mode, px(g.backdrop, x, y), px(g.source, x, y))), (y * width + x) * 4);
  return { width, height, rgba };
}

describe('C2 the W3C modes and add on a group: Vello CPU goldens against the f64 formula, Vello GPU against the goldens', () => {
  it('C2 every mode, blended over the ramp, matches its formula on the same 8-bit premultiplied inputs within one code value on 99.9% of the golden\'s pixels', () => {
    // The formula is an oracle only once it reproduces values the upstream suite states (mix.rs: "Color of rectangle should be …").
    expect(straight8(blendPixel('color', [122, 85, 73, 255], [255, 255, 0, 255])), 'mix_color_with_solid').toEqual([106, 106, 0, 255]);
    expect(straight8(blendPixel('saturation', [122, 85, 73, 255], [255, 255, 0, 255])), 'mix_saturation_with_solid').toEqual([213, 52, 0, 255]);
    const { alone, byMode } = goldens();
    const normal = byMode.get('normal')!;
    const failures: string[] = [];
    for (const m of MODES) {
      const g = byMode.get(m)!;
      // The inputs are the renderer's: the backdrop is the layer drawn before the group, and the source is the group's content whatever its mode.
      const b = within(g.backdrop, alone, 0);
      if (b.share !== 1) failures.push(`${m}: the backdrop input differs from the figure drawn without the group at (${b.worst?.x}, ${b.worst?.y}): ${JSON.stringify(b.worst?.a)} against ${JSON.stringify(b.worst?.b)}`);
      const s = within(g.source, normal.source, 0);
      if (s.share !== 1) failures.push(`${m}: the source input differs from the normal mode's at (${s.worst?.x}, ${s.worst?.y})`);
      const r = within(g.image, expected(m, g), 1);
      if (r.share < 0.999) failures.push(`${m}: ${(r.share * 100).toFixed(3)}% of ${r.n} pixels within one code value of the formula, under 99.9%; worst (${r.worst?.x}, ${r.worst?.y}) ${JSON.stringify(r.worst?.a)} against ${JSON.stringify(r.worst?.b)}`);
      // The fixture tells a mode apart: a renderer that ignored the mode (drew normal) would miss this mode's formula.
      if (m !== 'normal') {
        const apart = within(expected('normal', g), expected(m, g), 1);
        if (apart.share > 0.9) failures.push(`${m}: the fixture's formula is within one code of normal's on ${(apart.share * 100).toFixed(1)}% of pixels, so it tells nothing apart`);
      }
    }
    expect(failures, 'every mode against its formula').toEqual([]);
  }, 1_800_000);

  it('C2 Vello GPU matches each golden within one code value, six for color dodge and two for color burn, at every pixel', () => {
    needsMac();
    const d = dir();
    const lines = MODES.map((m) => drawLine(d, blendDoc(m), LOOK));
    const out = answers(builds.bin(RENDER), ['raster'], lines);
    const golden = new Map(MODES.map((m, i) => [m, readDrawn(lines[i]!, out[i]!, `the golden in ${m}`).image]));
    const gout = join(d, 'gpu');
    mkdirSync(gout);
    const replies = gpuReplies(builds.bin(DEEP_GPU), gout, MODES.map((m) => layersCall(blendDoc(m), LOOK, ['gpu_layer'])));
    const failures: string[] = [];
    for (const [i, m] of MODES.entries()) {
      const main = readLayers(gout, replies[i]!, `blend-${m}`).get('main');
      const gpu = sideOf(main, 'gpu_layer', `blend-${m}`).image;
      const r = within(gpu, golden.get(m)!, GPU_CODES[m]);
      if (r.share !== 1) failures.push(`${m}: Vello GPU differs from the Vello CPU golden by ${r.worst?.diff} codes at (${r.worst?.x}, ${r.worst?.y}) (${JSON.stringify(r.worst?.a)} against ${JSON.stringify(r.worst?.b)}), past its ${GPU_CODES[m]}; ${((1 - r.share) * r.n).toFixed(0)} pixels past it`);
    }
    expect(failures, 'Vello GPU against the goldens').toEqual([]);
  }, 1_800_000);

  it('C2 a blended group never blends with another writer\'s layer: where its own layer drew nothing it composites over the plate as source-over, in the golden', () => {
    const d = dir();
    const inputs = join(d, 'inputs');
    mkdirSync(inputs);
    const line = drawLine(d, acrossDoc(), LOOK, { blend_inputs: inputs });
    const drawn = readDrawn(line, answers(builds.bin(RENDER), ['raster'], [line])[0]!, 'the group across writers');
    const e = obj(arr(drawn.report['blend_inputs'], 'blend_inputs')[0], 'blend_inputs[0]');
    const backdrop = decodePng(readFileSync(str(e['backdrop'], 'backdrop')));
    const source = decodePng(readFileSync(str(e['source'], 'source')));
    const plate = [...(obj(LOOK['light'], 'light')['plate'] as number[]), 255].map((v) => v / 255) as Rgba;
    // The group's layer (main) composited over the other writer's plate, in the frame.
    const { width, height } = drawn.image;
    const want = new Uint8Array(width * height * 4);
    const wrong = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const b = px(backdrop, x, y); const s = px(source, x, y);
      want.set(straight8(over(blendPixel('multiply', b, s), plate)), (y * width + x) * 4);
      // The wrong program: the group multiplies with everything under it, the plate included.
      const under = straight8(over(premul8To01(b), plate)).map((v, i) => (i < 3 ? v : 255));
      wrong.set(straight8(blendPixel('multiply', under, s)), (y * width + x) * 4);
    }
    const right = (x: number, y: number): boolean => x >= 136 && x < 240 && y >= 8 && y < 120;
    expect(backdrop.rgba[(64 * width + 200) * 4 + 3], 'the backdrop input is transparent where the group\'s own layer drew nothing').toBe(0);
    const r = within(drawn.image, { width, height, rgba: want }, 1);
    expect(r.share, `the frame against main over the plate: worst (${r.worst?.x}, ${r.worst?.y}) ${JSON.stringify(r.worst?.a)} against ${JSON.stringify(r.worst?.b)}`).toBeGreaterThanOrEqual(0.999);
    const apart = within({ width, height, rgba: want }, { width, height, rgba: wrong }, 1, right);
    expect(apart.share, 'the fixture tells blending across writers apart on the right half').toBeLessThan(0.5);
  }, 1_800_000);

  it('C2 a blended group leaves another writer\'s layer as it was, drawn by Vello CPU and by Vello GPU', () => {
    needsMac();
    const out = dir();
    const [withGroup, without] = gpuReplies(builds.bin(DEEP_GPU), out, [
      layersCall(acrossDoc(), LOOK, ['vello_cpu', 'gpu_layer']), layersCall(acrossDoc({ group: false }), LOOK, ['vello_cpu', 'gpu_layer']),
    ]);
    const a = readLayers(out, withGroup!, 'across'); const b = readLayers(out, without!, 'across without the group');
    for (const r of ['vello_cpu', 'gpu_layer'] as const) {
      const x = sideOf(a.get('under'), r, `under (${r})`).image; const y = sideOf(b.get('under'), r, `under without the group (${r})`).image;
      const same = within(x, y, 0);
      expect(same.share, `${r}: the other writer's layer is the same pixels with and without the group; first difference (${same.worst?.x}, ${same.worst?.y})`).toBe(1);
      const m = sideOf(a.get('main'), r, `main (${r})`).image; const n = sideOf(b.get('main'), r, `main without the group (${r})`).image;
      expect(within(m, n, 1).share, `${r}: the group draws in its own layer`).toBeLessThan(0.9);
    }
  }, 1_800_000);

  it('C2 a blended group never changes a status color: the status mark under it is the same pixels with and without the group, in the golden', () => {
    const d = dir();
    const lines = [statusDoc(), statusDoc({ group: false }), statusDoc({ blend: 'normal' })].map((doc) => drawLine(d, doc, 'clean', { states: STATES }));
    const out = answers(builds.bin(RENDER), ['raster'], lines);
    const [a, b, n] = out.map((o, i) => readDrawn(lines[i]!, o, ['the status figure', 'the status figure without the group', 'the status figure with the group in normal'][i]!).image);
    expect(statusProblems(a!, b!), 'the status mark in the golden').toEqual([]);
    expect(within(a!, n!, 1, WASH_STRIP).share, 'the group does blend: beside the mark, multiply is not normal').toBeLessThan(0.5);
  }, 1_800_000);

  it('C2 in the app\'s window, a blended group never changes the card or a status color: both are the same pixels with and without the group', () => {
    needsMac();
    const out = dir();
    const [a, b, n] = gpuReplies(builds.bin(DEEP_GPU), out, [
      { call: 'window2d', doc: statusDoc(), look: 'clean', states: STATES, card: CARD },
      { call: 'window2d', doc: statusDoc({ group: false }), look: 'clean', states: STATES, card: CARD },
      { call: 'window2d', doc: statusDoc({ blend: 'normal' }), look: 'clean', states: STATES, card: CARD },
    ]);
    const wn = outPng(out, n!['window'], 'the window with the group in normal');
    const wa = outPng(out, a!['window'], 'the window'); const wb = outPng(out, b!['window'], 'the window without the group');
    const layer = arr(a!['layers'], 'layers').map((v) => obj(v, 'layers[]'));
    expect(layer.map((l) => [l['layer'], l['path']]), 'the blended layer is drawn on the GPU layer, through the handoff').toEqual([['main', 'gpu_layer']]);
    expect(statusProblems(wa, wb), 'the status mark in the window').toEqual([]);
    const [cx, cy, cw, ch] = CARD_RECT;
    const card = within(wa, wb, 0, (x, y) => x >= cx + 16 && x < cx + cw - 16 && y >= cy + 16 && y < cy + ch - 16);
    expect(card.share, `the card's interior is the same pixels; first difference (${card.worst?.x}, ${card.worst?.y}) ${JSON.stringify(card.worst?.a)} against ${JSON.stringify(card.worst?.b)}`).toBe(1);
    expect(within(wa, wn, 1, WASH_STRIP).share, 'the group does blend: beside the mark and the card, multiply is not normal').toBeLessThan(0.5);
  }, 1_800_000);
});

/** A strip of the group's wash left of the gate and the card, where multiply and normal differ. */
const WASH_STRIP = (x: number, y: number): boolean => x >= 22 && x < 34 && y >= 18 && y < 164;

/** The gate's box, 2 px in from its edge, is the same pixels in `a` and `b`, and holds the clean look's pass color. */
function statusProblems(a: Image, b: Image): string[] {
  const p: string[] = [];
  const [gx, gy, gw, gh] = GATE_BOX;
  const inside = (x: number, y: number): boolean => x >= gx + 2 && x < gx + gw - 2 && y >= gy + 2 && y < gy + gh - 2;
  const r = within(a, b, 0, inside);
  if (r.share !== 1) p.push(`the status mark's pixels change under the group: first (${r.worst?.x}, ${r.worst?.y}) ${JSON.stringify(r.worst?.a)} against ${JSON.stringify(r.worst?.b)}`);
  let pass = 0;
  for (let y = gy + 2; y < gy + gh - 2; y++) for (let x = gx + 2; x < gx + gw - 2; x++) if (diff(px(a, x, y).slice(0, 3), [0x00, 0x74, 0x29]) === 0) pass++;
  if (pass < 0.3 * (gw - 4) * (gh - 4)) p.push(`the status mark shows the pass color #007429 on ${pass} of its ${(gw - 4) * (gh - 4)} inner pixels`);
  return p;
}

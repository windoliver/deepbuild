// AC1 #430.e93f3c0b: A group whose passes blur it composites at its draw order: an item drawn after it stays sharp, one
// drawn before it is untouched, and nothing outside its bounds plus grow changes.
//
// The figure (helpers.ts: groupDoc) is whole-pixel rectangles on an opaque panel, so the answer comes from the fixture
// alone, with no reading of the renderer: the group's square, blurred by the fixture's own composed pass (25 taps,
// radius 6), cut at its bounds grown by 3, at opacity 0.75, over what was drawn before, under what was drawn after.
// Grow is under the blur's reach on purpose, so a blur that runs past bounds + grow writes pixels the answer says it
// can't. Pixels outside bounds + grow and the after bar are held to 0 codes (nothing changes); pixels the blur reached
// to 2 (one 8-bit rounding at the pass and one at the composite). A pack's blur has no answer in f64 here, since its
// `direction` is in uv of a target whose extent is the implementer's, so it's held to the same rules without one.
//
// `layers` is #385's call; the planted names and `packs` are this suite's (README). At the base the check refuses
// `passes`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AFTER, BEFORE, BLUR, LOOK, PANEL, REPO, SQUARE, answered, blurDoc, diff, failsNaming, groupDoc, grown, inBox, layerOf, layersCall, none, painted, px, readLayers,
  requireMetal, runGpu, useDir, useGpu, type Box, type Image, type JsonValue, type LayerDrawn, type Planted,
} from './helpers.ts';
import { gridBlur, over, type Rgba } from './reference.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();
const [W, H] = BLUR.size;
const LIMIT: Box = grown(SQUARE.box, BLUR.grow);

const before = painted([PANEL, ...BEFORE]);
const square = painted([SQUARE]);
const after = painted([AFTER]);
/** The figure in f64: `blurred` false draws the group with no pass. */
function answer(x: number, y: number, blurred = true): Rgba {
  const g = blurred ? (inBox(LIMIT, x, y) ? gridBlur(square, x, y, BLUR.stride) : [0, 0, 0, 0]) : square(x, y);
  return over(after(x, y), over(g.map((v) => v * BLUR.opacity), before(x, y)));
}
const codes = (p: readonly number[]): Rgba => p.map((v) => Math.round(v * 255)) as Rgba;
const nearBefore = (x: number, y: number): boolean => BEFORE.some((b) => inBox(grown(b.box, BLUR.radius), x, y));

/** Everything wrong with the drawn figure, by what the criterion calls it. */
function problems(im: Image): string[] {
  const bad = new Map<string, { n: number; first: string }>();
  const note = (name: string, x: number, y: number, got: Rgba, want: Rgba): void => {
    const e = bad.get(name) ?? { n: 0, first: `(${x}, ${y}) is ${JSON.stringify(got)}, not ${JSON.stringify(want)}` };
    e.n++; bad.set(name, e);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const got = px(im, x, y); const want = codes(answer(x, y));
    if (!inBox(LIMIT, x, y)) { if (diff(got, want) > 0) note('a pixel outside its bounds plus grow changed', x, y, got, want); continue; }
    if (inBox(AFTER.box, x, y)) { if (diff(got, want) > 0) note('the item drawn after it isn\'t sharp', x, y, got, want); continue; }
    if (diff(got, want) > 2) note(nearBefore(x, y) ? 'the item drawn before it isn\'t untouched' : 'the group isn\'t its blur at its draw order', x, y, got, want);
  }
  return [...bad].map(([name, e]) => `${name}: ${e.n} pixels; first ${e.first}`);
}

function draw(planted?: Planted): LayerDrawn {
  const out = dir();
  const [reply] = runGpu(bin(), out, [layersCall(blurDoc(), LOOK)], planted);
  return layerOf(readLayers(out, reply!, BLUR.size, 'the blurred group'), 'main', 'the blurred group');
}

describe(`${ID} a group's blur at its draw order`, () => {
  it(`${ID} the composed blur reads as the fixture's answer: drawn on the GPU layer, the after bar sharp, the before bars untouched, nothing past bounds + grow`, () => {
    // The answer tells each wrong program apart: the blur moves pixels, and it would reach past the cut if nothing cut it.
    let moved = 0; let past = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (inBox(LIMIT, x, y) && diff(codes(answer(x, y)), codes(answer(x, y, false))) > 8) moved++;
      if (!inBox(LIMIT, x, y) && !inBox(AFTER.box, x, y) && diff(gridBlur(square, x, y, BLUR.stride), [0, 0, 0, 0]) > 0.01) past++;
    }
    expect(moved, 'the blur moves pixels inside bounds + grow').toBeGreaterThan(300);
    expect(past, 'an uncut blur would reach past bounds + grow').toBeGreaterThan(100);
    requireMetal();
    const main = draw();
    expect(main.dim, 'a layer of rectangles is 2D').toBe('2d');
    expect(main.path, 'a 2D writer layer with passes moves to the GPU layer').toBe('gpu_layer');
    none(problems(main.image), 'the figure against its answer');
  }, 1_800_000);

  it(`${ID} a pack's pass by name, fx.directional_blur@1 with grow 16: nothing past bounds + grow, the after bar sharp, the group blurred`, () => {
    requireMetal();
    const out = dir();
    const extra = { packs: ['deepbuild/fx@1.0.0'] };
    const doc = groupDoc('pack-blur-430', [{ op: 'fx.directional_blur@1', params: { direction: [0.06, 0] as JsonValue, taps: 9 }, grow: 16 }], {}, extra);
    const [reply, plain, bare] = runGpu(bin(), out, [
      layersCall(doc, LOOK, { packs: [join(REPO, 'packs', 'fx-1.0.0')] }), layersCall(groupDoc('plain-430', []), LOOK), layersCall(groupDoc('no-group-430', null), LOOK),
    ]);
    const main = layerOf(readLayers(out, answered(reply!, 'the pack\'s blur'), BLUR.size, 'the pack\'s blur'), 'main', 'the pack\'s blur');
    const unblurred = layerOf(readLayers(out, plain!, BLUR.size, 'the group with no pass'), 'main', 'the group with no pass');
    const without = layerOf(readLayers(out, bare!, BLUR.size, 'the figure with no group'), 'main', 'the figure with no group');
    const limit = grown(SQUARE.box, 16);
    const found: string[] = []; let moved = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const got = px(main.image, x, y);
      if (!inBox(limit, x, y) && diff(got, px(without.image, x, y)) > 0) found.push(`a pixel outside its bounds plus grow changed at (${x}, ${y})`);
      if (inBox(AFTER.box, x, y) && diff(got, codes(after(x, y))) > 0) found.push(`the item drawn after it isn't sharp at (${x}, ${y})`);
      if (!inBox(AFTER.box, x, y) && diff(got, px(unblurred.image, x, y)) > 8) moved++;
    }
    none(found.slice(0, 20), 'the pack\'s blur');
    expect(moved, 'the pack\'s pass blurs the group').toBeGreaterThan(100);
  }, 1_800_000);

  it(`${ID} planted: passes run at the layer's end, on what was drawn before, and past grow; each fails naming what it broke`, () => {
    requireMetal();
    failsNaming(problems(draw('group_pass_at_layer_end').image), ['the item drawn after it'], 'group_pass_at_layer_end');
    failsNaming(problems(draw('group_pass_reads_earlier').image), ['the item drawn before it'], 'group_pass_reads_earlier');
    failsNaming(problems(draw('group_pass_past_grow').image), ['outside its bounds plus grow'], 'group_pass_past_grow');
  }, 1_800_000);
});

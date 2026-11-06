// AC2 #430.618fe52c: A backdrop group with a blur blurs only what its own writer layer drew before it, inside its
// coverage, while another writer's layer, the card and status colors keep their pixels.
//
// Upstream, ported (README: The oracle page): WPT's backdrop-filter rule with the writer layer as the root. Paint order
// (only what's painted before is filtered) is the `later` bar here; backdrop-filter-clipped.html and
// backdrop-filter-isolation-isolate.html (a rounded clip and isolation form no root) are their own two figures, with
// WPT's own colors and answers.
//
// The first test draws each writer layer alone: inside coverage, past the blur's reach from its edge, `main` holds the
// fixture's answer in f64 (the blur of its own earlier rectangles) to 2 of 255; outside coverage it is the same pixels
// as with no group, and the other writer's layer is too. The edge band a blur's reach wide is judged only for what's
// outside it: which pixels a tap past coverage reads is left to the implementer (README: Readings).
//
// The second test shows the window. Status marks and the card are compared with and without the group, and with the
// status state flipped: whatever differs between the two states with no group is the status mark's own pixels, and
// with the group nothing else may differ, so the blur read no status color. `layers` is #385's and `window2d` #385's;
// `float` and the planted names are this suite's (README).
import { describe, expect, it } from 'vitest';
import {
  AC, BACK, CARD_RECT, GATE_BOX, LOOK, WINDOW, WPT_BOX, WPT_ISOLATION, backdropDoc, decodePng, diff, failsNaming, floatsOf, fx, grown, hasFile, inBox, layerOf, layersCall, none,
  painted, px, readLayers, requireMetal, runGpu, str, useDir, useGpu, windowCall, windowDoc, wptClippedDoc, wptIsolationDoc, type Box, type Image, type JsonObject, type LayerDrawn, type Planted,
} from './helpers.ts';
import { gridBlur } from './reference.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
const [W, H] = BACK.size;
const before = painted(BACK.before);
const REACH = BACK.radius;
const inner: Box = grown(BACK.coverage.box, -REACH);
const CODES = 2 / 255;

interface Layers { main: LayerDrawn; mainWithout: LayerDrawn; under: LayerDrawn; underWithout: LayerDrawn }
function drawLayers(planted?: Planted): Layers {
  const out = dir();
  const [a, b] = runGpu(bin(), out, [layersCall(backdropDoc('backdrop-430', true), LOOK, { float: true }), layersCall(backdropDoc('backdrop-none-430', false), LOOK)], planted);
  const withGroup = readLayers(out, a!, BACK.size, 'the backdrop group'); const without = readLayers(out, b!, BACK.size, 'the figure with no group');
  return {
    main: layerOf(withGroup, 'main', 'with the group'), mainWithout: layerOf(without, 'main', 'with no group'),
    under: layerOf(withGroup, 'under', 'with the group'), underWithout: layerOf(without, 'under', 'with no group'),
  };
}
function layerProblems(l: Layers): string[] {
  const floats = floatsOf(l.main, 'main');
  const bad = new Map<string, { n: number; first: string }>();
  const note = (name: string, x: number, y: number, got: readonly number[], want: readonly number[]): void => {
    const e = bad.get(name) ?? { n: 0, first: `(${x}, ${y}) is ${JSON.stringify(got.map((v) => +v.toFixed(4)))}, not ${JSON.stringify(want.map((v) => +v.toFixed(4)))}` };
    e.n++; bad.set(name, e);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (diff(px(l.under.image, x, y), px(l.underWithout.image, x, y)) > 0) note('another writer\'s layer changed', x, y, px(l.under.image, x, y), px(l.underWithout.image, x, y));
    if (!inBox(BACK.coverage.box, x, y)) {
      if (diff(px(l.main.image, x, y), px(l.mainWithout.image, x, y)) > 0) note('a pixel outside its coverage changed', x, y, px(l.main.image, x, y), px(l.mainWithout.image, x, y));
      continue;
    }
    if (!inBox(inner, x, y)) continue;
    if (inBox(BACK.later.box, x, y)) {
      if (diff(px(l.main.image, x, y), [255, 0, 255, 255]) > 0) note('the item drawn after it isn\'t sharp', x, y, px(l.main.image, x, y), [255, 0, 255, 255]);
      continue;
    }
    const got = fx(floats, x, y); const want = gridBlur(before, x, y, BACK.stride);
    if (diff(got, want) <= CODES) continue;
    if (inBox(grown(BACK.later.box, REACH), x, y)) note('the blur read an item drawn after it', x, y, got, want);
    else if (x >= BACK.panelEnd + REACH) note('the blur read another writer\'s layer', x, y, got, want);
    else note('it isn\'t the blur of what its own layer drew before it', x, y, got, want);
  }
  return [...bad].map(([name, e]) => `${name}: ${e.n} pixels; first ${e.first}`);
}

/** WPT's two no-root figures, each read on its own answer, at least 2 px in from every edge. */
function wptProblems(): string[] {
  const out = dir();
  const [clipped, isolation] = runGpu(bin(), out, [layersCall(wptClippedDoc(), LOOK), layersCall(wptIsolationDoc(), LOOK)]);
  const c = layerOf(readLayers(out, clipped!, [120, 160], 'WPT clipped'), 'main', 'WPT clipped').image;
  const i = layerOf(readLayers(out, isolation!, [260, 320], 'WPT isolation'), 'main', 'WPT isolation').image;
  const found: string[] = [];
  const check = (name: string, im: Image, box: Box, want: number[]): void => {
    const [x0, y0, w, h] = grown(box, -2);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (diff(px(im, x, y), want) > 1) { found.push(`${name}: (${x}, ${y}) is ${JSON.stringify(px(im, x, y))}, not ${JSON.stringify(want)}`); return; }
  };
  check('backdrop-filter-clipped, "A green box"', c, WPT_BOX, [0, 128, 0, 255]);
  const overlap = (a: Box, b: Box): Box => { const x = Math.max(a[0], b[0]); const y = Math.max(a[1], b[1]); return [x, y, Math.min(a[0] + a[2], b[0] + b[2]) - x, Math.min(a[1] + a[3], b[1] + b[3]) - y]; };
  check('backdrop-filter-isolation-isolate, the box outside the isolated group', i, overlap(WPT_ISOLATION.outside, WPT_ISOLATION.cover), [255, 127, 255, 255]);
  check('backdrop-filter-isolation-isolate, the box inside it', i, overlap(WPT_ISOLATION.inside, WPT_ISOLATION.cover), [255, 127, 255, 255]);
  return found;
}

interface Windows { pass: Image; fail: Image; passWithout: Image; failWithout: Image; paths: JsonObject[] }
function drawWindows(planted?: Planted): Windows {
  const out = dir();
  const replies = runGpu(bin(), out, [windowCall(windowDoc(true), 'pass'), windowCall(windowDoc(true), 'fail'), windowCall(windowDoc(false), 'pass'), windowCall(windowDoc(false), 'fail')], planted);
  const [pass, fail, passWithout, failWithout] = replies.map((r, i) => decodePng(hasFile(out, r['window'], 'png', `window ${i}`)));
  return { pass: pass!, fail: fail!, passWithout: passWithout!, failWithout: failWithout!, paths: (replies[0]!['layers'] as JsonObject[] | undefined) ?? [] };
}
function windowProblems(w: Windows): string[] {
  const [W2, H2] = WINDOW.size;
  const [cx, cy, cw, ch] = CARD_RECT;
  // Inset past the card's own corner rounding and shadow, as #385's check is.
  const card: Box = [cx + 16, cy + 16, cw - 32, ch - 32];
  const reach = 2 * WINDOW.stride;
  const onlyOther: Box = [WINDOW.panelEnd + reach, WINDOW.coverage[1] + reach, cx - WINDOW.panelEnd - 2 * reach, WINDOW.coverage[3] - 2 * reach];
  const found = new Map<string, number>();
  const note = (name: string): void => { found.set(name, (found.get(name) ?? 0) + 1); };
  let status = 0; let blurred = 0;
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const own = diff(px(w.passWithout, x, y), px(w.failWithout, x, y)) > 0; // the status mark's own pixels, its legend's among them
    const moved = diff(px(w.pass, x, y), px(w.passWithout, x, y));
    if (own) {
      status++;
      if (moved > 0 || diff(px(w.fail, x, y), px(w.failWithout, x, y)) > 0) note('a status color changed');
    } else if (diff(px(w.pass, x, y), px(w.fail, x, y)) > 0) note('the blur read a status color');
    if (inBox(card, x, y) && moved > 0) note('the card changed');
    if (inBox(onlyOther, x, y) && moved > 0) note('another writer\'s layer changed');
    if (!inBox(WINDOW.coverage, x, y) && !inBox(CARD_RECT, x, y) && moved > 0) note('a pixel outside its coverage changed');
    if (inBox(WINDOW.coverage, x, y) && !inBox(CARD_RECT, x, y) && !inBox(GATE_BOX, x, y) && moved > 8) blurred++;
  }
  const out = [...found].map(([name, n]) => `${name}: ${n} pixels`);
  if (status < 100) out.push(`the fixture shows no status mark: ${status} pixels differ between pass and fail with no group`);
  if (blurred < 100) out.push(`the backdrop group blurred nothing in the window: ${blurred} pixels moved`);
  return out;
}

describe(`${ID} a backdrop group's blur`, () => {
  it(`${ID} each layer alone: inside coverage the blur of what its own layer drew before it; outside coverage and in the other writer's layer the same pixels; WPT's clipped and isolation figures`, () => {
    requireMetal();
    const l = drawLayers();
    expect(l.main.path, 'a 2D writer layer with passes moves to the GPU layer').toBe('gpu_layer');
    none(layerProblems(l), 'the layers against their answer');
    none(wptProblems(), 'WPT\'s figures, the writer layer as root');
  }, 1_800_000);

  it(`${ID} in the window: another writer's layer, the card and status colors keep their pixels, and flipping the status state moves only the status mark's own pixels`, () => {
    requireMetal();
    const w = drawWindows();
    expect(w.paths.map((p) => [str(p['layer'], 'layer'), p['path']]), 'each writer layer on its path').toEqual([['under', 'gpui'], ['main', 'gpu_layer']]);
    none(windowProblems(w), 'the window');
  }, 1_800_000);

  it(`${ID} planted: a backdrop reading another writer's layer, items drawn after it, or status colors, or writing past coverage, fails naming it`, () => {
    requireMetal();
    failsNaming(layerProblems(drawLayers('backdrop_reads_other_writer')), ['another writer\'s layer'], 'backdrop_reads_other_writer');
    failsNaming(layerProblems(drawLayers('backdrop_reads_later_items')), ['an item drawn after it'], 'backdrop_reads_later_items');
    failsNaming(layerProblems(drawLayers('backdrop_past_coverage')), ['outside its coverage'], 'backdrop_past_coverage');
    failsNaming(windowProblems(drawWindows('backdrop_reads_status')), ['read a status color'], 'backdrop_reads_status');
  }, 3_600_000);
});

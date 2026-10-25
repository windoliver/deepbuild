// #377.30608b7b: with a GPU-layer view under the question card's slot, the card's interior pixels in a
// window capture equal its isolated render on the zero-copy and the copy paths; a patch that draws
// surfaces after GPUI's scene covers the card and fails. The card is the shell's, presented in the slot
// the call gives (as #393's); its isolated render is the same window with no GPU-layer view; its interior
// is the slot 16 px in from its edge. At the base there is no `deep-gpu` binary.
import { describe, expect, it } from 'vitest';
import { SCENES, expectNotBlank, framesCall, framesReply, loadScene, readCapture, run, scenario, useBuilds, useOut, type Image, type JsonObject } from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const SCENE = loadScene(SCENES.handoff);

/** The card's slot in window px: inside the view (32, 32, 1936 × 1584), over the opaque background and the marker's path. */
const RECT: [number, number, number, number] = [700, 300, 480, 240];
const CARD: JsonObject = { ask: 'ask:01JB7A0000000000000000377', question: 'Ship the GPU layer?', options: [{ id: 'ship', label: 'Ship it' }, { id: 'hold', label: 'Not yet' }], rect: RECT };
const INSET = 16;
const INTERIOR: [number, number, number, number] = [RECT[0] + INSET, RECT[1] + INSET, RECT[2] - 2 * INSET, RECT[3] - 2 * INSET];

/** Interior pixels that differ between two captures, with the first one named. */
function interiorDiff(a: Image, b: Image): { count: number; first: string } {
  let count = 0; let first = '';
  const [x0, y0, w, h] = INTERIOR;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const o = (y * a.width + x) * 4;
    if (a.rgba[o] !== b.rgba[o] || a.rgba[o + 1] !== b.rgba[o + 1] || a.rgba[o + 2] !== b.rgba[o + 2]) {
      count++;
      if (!first) first = `(${x}, ${y}): ${a.rgba.slice(o, o + 3).join(',')} against ${b.rgba.slice(o, o + 3).join(',')}`;
    }
  }
  return { count, first };
}

function captures(planted?: 'draws_surfaces_after_scene'): { isolated: Image; zero: Image; copy: Image; bare: Image } {
  const o = out();
  const [isolated, zero, copy, bare] = run(builds.bin(), scenario(o, [
    framesCall({ scene: SCENES.handoff, count: 1, layer: false, card: CARD, capture: 'every' }),
    framesCall({ scene: SCENES.handoff, count: 1, path: 'zero_copy', card: CARD, capture: 'every' }),
    framesCall({ scene: SCENES.handoff, count: 1, path: 'copy', card: CARD, capture: 'every' }),
    framesCall({ scene: SCENES.handoff, count: 1, path: 'zero_copy', capture: 'every' }),
  ]), planted ? { planted } : {});
  const read = (reply: JsonObject, what: string): Image => readCapture(o, framesReply(reply, what).frames[0]!.window, what);
  return { isolated: read(isolated!, 'the card\'s isolated render'), zero: read(zero!, 'zero copy under the card'), copy: read(copy!, 'copy under the card'), bare: read(bare!, 'the view with no card') };
}

describe('#377.30608b7b with a GPU-layer view under the card\'s slot, the card\'s interior pixels equal its isolated render on both paths; a patch that draws surfaces after GPUI\'s scene covers the card and fails', () => {
  it('#377.30608b7b on the zero-copy and the copy paths the card\'s interior in the window capture equals its isolated render, pixel for pixel', () => {
    const { isolated, zero, copy, bare } = captures();
    expect(SCENE.view[0] < RECT[0] && SCENE.view[1] < RECT[1] && RECT[0] + RECT[2] < SCENE.view[0] + SCENE.size[0] && RECT[1] + RECT[3] < SCENE.view[1] + SCENE.size[1], 'the slot lies over the GPU-layer view').toBe(true);
    expectNotBlank(isolated, 'the card\'s isolated interior', INTERIOR);
    // The view really draws under the slot: without the card its pixels there differ from the card's.
    expect(interiorDiff(bare, isolated).count, 'the GPU-layer view draws under the card\'s slot').toBeGreaterThan(0);
    for (const [name, img] of [['zero copy', zero], ['copy', copy]] as const) {
      const d = interiorDiff(img, isolated);
      expect(d.count, `${name}: interior pixels that differ from the card's isolated render (first ${d.first})`).toBe(0);
    }
  }, 1_800_000);

  it('#377.30608b7b a planted GPUI patch that draws surfaces after its scene (--planted draws_surfaces_after_scene) covers the card and fails', () => {
    const { isolated, zero } = captures('draws_surfaces_after_scene');
    const d = interiorDiff(zero, isolated);
    expect(d.count, 'the planted patch draws the surface over the card, so the interior differs from its isolated render').toBeGreaterThan(0);
  }, 1_800_000);
});

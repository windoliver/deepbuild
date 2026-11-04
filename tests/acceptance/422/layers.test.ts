// AC7 #422.4f7bd0ec: With another writer's layer holding a box behind your wall, your wall hides the box where it
// covers it, your light lights the box and the box's shadow falls on your floor, while each layer still composites in
// its own band and hiding the other layer removes the box and its shadow.
//
// One scene3d document with two writer layers (Writer layer): yours, `mine`, written by `you:owner`, holds the camera,
// the sky (a little ambient light), the floor, a wall and the key sun; another writer's, `theirs`, written by
// `agent:sess-beta`, holds a red box behind the right end of the wall, so the wall covers its lower left part from the
// camera. `view3d` draws, with the linear and object-ID targets: A, the document; H, the document with `theirs` hidden
// (`hidden`, the layer's `visible` session state); N, the document without `theirs`; C, the document without the wall;
// S, the document without the sun. Then:
//   - the wall hides the box where it covers it: of the pixels where C shows the box, those where H shows the wall
//     (1 px in from the wall's edge) show the wall in A, and the rest (1 px away from it) show the box, 99.5% of each,
//     with at least 500 of each;
//   - your light lights the box: its mean linear luminance in A is at least twice that in S;
//   - the box's shadow falls on your floor: at least 300 pixels that show the floor in both A and H are 25% darker in A;
//   - each layer composites in its own band: A's reply lists the layers back to front with the band its writer's kind
//     gives (Band): `mine` in `work`, then `theirs` in `agent`;
//   - hiding the other layer removes the box and its shadow: H shows no box, and every pixel of H is within 1% of N in
//     linear luminance.
// Wrong programs: layers drawn one after another by band, each with its own depth, so the agent's box draws over your
// wall; lights or shadows kept within their writer's layer; a hidden layer that still casts or still counts; a band
// picked by the layer or by document order; the base, which has no `hidden` and reports no layers.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN_LOOK, arr, box, camera, clone, frameAt, framesOf, inside, lum, material, obj, readIds, readLinear, runGpu, sessionDoc, str, sun,
  requireMetal, useDir, useGpu, view3dCall, writeJson,
  type Ids, type JsonObject, type Linear,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [640, 480];
const LAYERS = { mine: 'you:owner', theirs: 'agent:sess-beta' };

function sharedDoc(): JsonObject {
  return sessionDoc('shared-depth', SIZE, {
    cam: camera([0, 3, 6], [0.5, 0.5, 0], 45, { near: 0.1, far: 100 }),
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0.2, 0.2, 0.2], ambient_low: [0.1, 0.1, 0.1] } },
    grey: material({ base_color: [0.7, 0.7, 0.7, 1], roughness: 0.9 }),
    floor: box([12, 0.1, 12], { pos: [0, -0.05, 0] }, { material: 'grey' }),
    wall: box([3, 1, 0.2], { pos: [-0.5, 0.5, 1] }, { material: 'grey' }),
    sun: sun(3, [-40, -60, 0], { shadow: true }),
    red: { ...material({ base_color: [0.8, 0.1, 0.1, 1], roughness: 0.8 }), layer: 'theirs' },
    box: box([1, 1.2, 1], { pos: [0.9, 0.6, -0.6] }, { material: 'red', layer: 'theirs' }),
  }, {}, LAYERS);
}
function without(doc: JsonObject, ids: string[], layer?: string): JsonObject {
  const d = clone(doc);
  const items = obj(d['items'], 'items');
  for (const id of ids) delete items[id];
  if (layer) delete obj(d['layers'], 'layers')[layer];
  return d;
}

interface Render { linear: Linear; ids: Ids; reply: JsonObject }
function draw(out: string, docs: [string, JsonObject, string[]][]): Render[] {
  const replies = runGpu(bin(), out, docs.map(([name, doc, hidden]) => view3dCall({ doc: writeJson(out, name, doc), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['linear', 'ids'], hidden })));
  return replies.map((r, i) => {
    const f = frameAt(framesOf(r, docs[i]![0]), 0, docs[i]![0]);
    return { linear: readLinear(out, f.linear, SIZE, `${docs[i]![0]}: linear`), ids: readIds(out, f, `${docs[i]![0]}: ids`), reply: r };
  });
}

describe(`${AC[7]} another writer's layer shares your scene's depth, light and shadow`, () => {
  it(`${AC[7]} your wall hides their box where it covers it, your sun lights it and its shadow falls on your floor; each layer composites in its own band; hiding their layer removes the box and its shadow`, () => {
    requireMetal();
    const out = dir();
    const doc = sharedDoc();
    const [a, h, n, c, s] = draw(out, [
      ['A', doc, []], ['H', doc, ['theirs']], ['N', without(doc, ['box', 'red'], 'theirs'), []], ['C', without(doc, ['wall']), []], ['S', without(doc, ['sun']), []],
    ]) as [Render, Render, Render, Render, Render];
    const [w, ht] = SIZE;

    // The wall hides the box where it covers it, and only there.
    const wallIn = new Set(inside(h.ids, 'wall', 1).map(([x, y]) => y * w + x));
    let covered = 0; let coveredRight = 0; let open = 0; let openRight = 0;
    for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) {
      if (c.ids.at(x, y) !== 'box') continue;
      const nearWall = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => h.ids.at(x + dx, y + dy) === 'wall'));
      if (wallIn.has(y * w + x)) { covered++; if (a.ids.at(x, y) === 'wall') coveredRight++; }
      else if (!nearWall) { open++; if (a.ids.at(x, y) === 'box') openRight++; }
    }
    console.log(`${AC[7]}: the box's pixels: ${covered} behind the wall (${coveredRight} show the wall), ${open} in the open (${openRight} show the box)`);
    expect(covered, 'the wall covers at least 500 of the box\'s pixels (the fixture)').toBeGreaterThanOrEqual(500);
    expect(open, 'at least 500 of the box\'s pixels are clear of the wall (the fixture)').toBeGreaterThanOrEqual(500);
    expect(coveredRight / covered, 'your wall hides their box where it covers it (99.5% of those pixels show the wall)').toBeGreaterThanOrEqual(0.995);
    expect(openRight / open, 'their box shows where your wall doesn\'t cover it (99.5% of those pixels show the box)').toBeGreaterThanOrEqual(0.995);

    // Your light lights the box.
    const meanOn = (r: Render, id: string): number => {
      let sum = 0; let k = 0;
      for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) if (r.ids.at(x, y) === id) { sum += lum(r.linear.at(x, y)); k++; }
      return k ? sum / k : 0;
    };
    const lit = meanOn(a, 'box'); const unlit = meanOn(s, 'box');
    console.log(`${AC[7]}: the box's mean linear luminance ${lit.toFixed(4)} with your sun, ${unlit.toFixed(4)} without it`);
    expect(lit, 'your sun lights their box: at least twice its luminance without the sun').toBeGreaterThanOrEqual(2 * unlit);

    // The box's shadow falls on your floor.
    let shadowed = 0;
    for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) {
      if (a.ids.at(x, y) !== 'floor' || h.ids.at(x, y) !== 'floor') continue;
      if (lum(a.linear.at(x, y)) < 0.75 * lum(h.linear.at(x, y))) shadowed++;
    }
    console.log(`${AC[7]}: ${shadowed} floor pixels darkened by their box`);
    expect(shadowed, 'their box\'s shadow falls on your floor: at least 300 floor pixels 25% darker than with their layer hidden').toBeGreaterThanOrEqual(300);

    // Each layer composites in its own band.
    const layers = arr(a.reply['layers'], 'the reply\'s layers').map((v, i) => {
      const o = obj(v, `layers[${i}]`);
      return { layer: str(o['layer'], `layers[${i}].layer`), writer: str(o['writer'], `layers[${i}].writer`), band: str(o['band'], `layers[${i}].band`) };
    });
    expect(layers, 'the layers back to front, each in the band its writer\'s kind gives').toEqual([
      { layer: 'mine', writer: LAYERS.mine, band: 'work' }, { layer: 'theirs', writer: LAYERS.theirs, band: 'agent' },
    ]);

    // Hiding their layer removes the box and its shadow.
    expect(h.ids.count.get('box') ?? 0, 'with their layer hidden, no pixel shows the box').toBe(0);
    let off = 0; let first = '';
    for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) {
      const p = lum(h.linear.at(x, y)); const q = lum(n.linear.at(x, y));
      if (Math.abs(p - q) > 0.01 * Math.max(q, 1e-3)) { off++; if (!first) first = `(${x}, ${y}): ${p.toFixed(5)} hidden, ${q.toFixed(5)} without the layer`; }
    }
    expect(off, `with their layer hidden the frame is the frame without it, within 1% at every pixel: ${off} differ, first ${first}`).toBe(0);
  }, 1_800_000);
});

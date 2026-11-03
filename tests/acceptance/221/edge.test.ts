// AC3: "A title with `edge: n` has its top side at the safe margin (24 u) ± 0.5 px at 1920 × 1080 and at 1080 × 1920"
//
// Oracle lane (README): ManimGX cfd33af5aa tests/unit/test_mobject.py:459-468
// (test_to_edge_puts_the_box_buff_in_from_the_frames_edge: to_edge toward each of eight directions puts the box's
// side buff in from the frame's edge) is ported onto a rect placed with `edge` toward each of the eight sides, at both
// frame shapes, with the default margin and with margin 10.
import { describe, expect, it } from 'vitest';
import {
  PX, SAFE, TIMEOUT, clone, expectClean, fmt, fmtBox, geometryOf, inkInsideFailures, isInk, itemOf, loadDoc, none, rasterAll, scratch,
  useRenderBinary, x1, y1, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const store = scratch('store');
const pngs = scratch('png');

const SHAPES: [number, number][] = [[1920, 1080], [1080, 1920]];

function titleAt(size: [number, number], extra: JsonObject = {}, strip = false): JsonObject {
  const doc = clone(loadDoc('edge-title.json'));
  doc['id'] = `rel-221-edge-title-${size[0]}x${size[1]}${strip ? '-free' : ''}${'safe' in extra ? `-safe${String(extra['safe'])}` : ''}`;
  doc['size'] = size;
  Object.assign(doc, extra);
  if (strip) delete (itemOf(doc, 'title')['at'] as JsonObject)['place'];
  return doc;
}

describe('AC3 a title on the frame\'s top edge', () => {
  it('AC3 a title with edge: n has its top side at the safe margin (24 u) ± 0.5 px at 1920 × 1080 and at 1080 × 1920', () => {
    const placed = SHAPES.map((s) => titleAt(s));
    const free = SHAPES.map((s) => titleAt(s, {}, true));
    expectClean([...placed, ...free], store);
    const g = geometryOf(placed, 'title', store);
    const f = geometryOf(free, 'title', store);
    const failures: string[] = [];
    SHAPES.forEach((s, k) => {
      const box = g[k]!.box;
      if (Math.abs(box[1] - SAFE) > PX) failures.push(`at ${s[0]} × ${s[1]}: the title's top side is at ${fmt(box[1])}, not the safe margin ${SAFE} ± ${PX} (box ${fmtBox(box)})`);
      // edge: n moves only along y: x is where the title's at.pos (200) puts it without the relation.
      if (Math.abs(box[0] - f[k]!.box[0]) > PX) failures.push(`at ${s[0]} × ${s[1]}: edge n moved the title along x, from ${fmt(f[k]!.box[0])} to ${fmt(box[0])}`);
      if (Math.abs(box[2] - f[k]!.box[2]) > PX || Math.abs(box[3] - f[k]!.box[3]) > PX) failures.push(`at ${s[0]} × ${s[1]}: the relation resized the title, ${fmtBox(f[k]!.box)} to ${fmtBox(box)}`);
    });
    none(failures, 'the title sits at the safe margin');
    // Render-back's box is where the title draws.
    const images = rasterAll(pngs, placed, store);
    none(images.flatMap((image, k) => inkInsideFailures(image, isInk, g[k]!.box, `the title at ${SHAPES[k]!.join(' × ')}`)), 'the title draws inside its box');
  }, TIMEOUT);

  it('AC3 the margin defaults to the document\'s safe: with safe 40 the title\'s top side is at 40 ± 0.5 px at both frame shapes', () => {
    // A margin written as the number 24 instead of `safe` passes the test above and fails this one.
    const docs = SHAPES.map((s) => titleAt(s, { safe: 40 }));
    expectClean(docs, store);
    const g = geometryOf(docs, 'title', store);
    none(SHAPES.flatMap((s, k) => (Math.abs(g[k]!.box[1] - 40) > PX ? [`at ${s.join(' × ')} with safe 40: the title's top side is at ${fmt(g[k]!.box[1])}`] : [])), 'margin = safe');
  }, TIMEOUT);

  it('AC3 oracle port (test_to_edge_puts_the_box_buff_in_from_the_frames_edge, test_mobject.py:459-468): edge toward each of the eight sides puts the box\'s side the margin in from the frame\'s edge, at both frame shapes, moving only along that edge\'s axis', () => {
    const sides = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
    const margins: (number | undefined)[] = [undefined, 10];
    const docs: JsonObject[] = [];
    const cases: { side: string; margin: number; size: [number, number] }[] = [];
    for (const size of SHAPES) for (const side of sides) for (const margin of margins) {
      const doc: JsonObject = {
        format: 1, id: `rel-221-to-edge-${size[0]}x${size[1]}-${side}-${margin ?? 'safe'}`, profile: 'figure', title: 'A rect on a frame edge',
        description: 'Issue #221 AC3 oracle port: a rect placed with edge toward one side of the frame.', size,
        layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
        items: { card: { id: 'card', kind: 'rect@1', layer: 'main', name: 'Card', order: 'a1', at: { place: margin === undefined ? { edge: side } : { edge: side, margin } }, params: { box: [300, 400, 120, 50], paint: { fill: { role: 'accent' } } } } },
      };
      docs.push(doc);
      cases.push({ side, margin: margin ?? SAFE, size });
    }
    expectClean(docs, store);
    const g = geometryOf(docs, 'card', store);
    const failures: string[] = [];
    cases.forEach((c, k) => {
      const b = g[k]!.box;
      const [W, H] = c.size;
      const what = `edge ${c.side}, margin ${c.margin}, at ${W} × ${H}`;
      const wantX = c.side.includes('w') ? c.margin : c.side.includes('e') ? W - c.margin - 120 : 300;
      const wantY = c.side.startsWith('n') ? c.margin : c.side.startsWith('s') ? H - c.margin - 50 : 400;
      if (Math.abs(b[0] - wantX) > PX || Math.abs(b[1] - wantY) > PX || Math.abs(x1(b) - (wantX + 120)) > PX || Math.abs(y1(b) - (wantY + 50)) > PX) {
        failures.push(`${what}: the box is ${fmtBox(b)}, want [${wantX}, ${wantY}, 120, 50]`);
      }
    });
    none(failures, 'to_edge');
    expect(cases.length).toBe(32);
  }, TIMEOUT);
});

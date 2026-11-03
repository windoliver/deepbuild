// The issue's Proof: "A positions figure (nine dots, each labelled `next_to(dot, DOWN, buff=0.2)` over a background
// rectangle) and a quadratic-formula figure's labels, built as documents, with render-back boxes in the receipt."
//
// Both figures are documents under fixtures/. Each is checked, its items' boxes are read back (geometry), each
// relation is held to its numbers, and each label's ink in the drawn frame lies inside its read-back box, so the boxes
// a receipt carries are where the items draw. ManimGX's buff 0.2 is in its frame units, 8 to the frame's height: at
// 1080 u, 0.2 × 1080 ÷ 8 = 27 u, the labels' gap.
import { describe, expect, it } from 'vitest';
import {
  PX, TIMEOUT, cx, cy, expectClean, fmt, fmtBox, geometryOf, inkInsideFailures, isAccent, isInk, itemOf, loadDoc, none, rasterAll, scratch,
  useRenderBinary, x1, y1, type Geo,
} from './helpers.ts';

useRenderBinary();
const store = scratch('store');
const pngs = scratch('png');

const one = (doc: Parameters<typeof geometryOf>[0][number], item: string): Geo => geometryOf([doc], item, store)[0]!;

describe('Proof: the positions figure and the quadratic formula\'s labels, built as documents', () => {
  it('Proof: nine dots, each labelled next_to(dot, DOWN, buff=0.2) 27 u below it, centred, over a background rectangle centred on the label; each label draws inside its box', () => {
    const doc = loadDoc('positions.json');
    expectClean([doc], store);
    const [image] = rasterAll(pngs, [doc], store);
    const failures: string[] = [];
    for (let k = 1; k <= 9; k++) {
      const dot = one(doc, `dot${k}`).box; const label = one(doc, `label${k}`).box; const back = one(doc, `back${k}`).box;
      const center = (itemOf(doc, `dot${k}`)['params'] as { center: [number, number] }).center;
      if (Math.abs(dot[0] - (center[0] - 8)) > PX || Math.abs(dot[1] - (center[1] - 8)) > PX) failures.push(`dot ${k}'s box ${fmtBox(dot)} is not its circle's`);
      if (Math.abs(label[1] - (y1(dot) + 27)) > PX) failures.push(`label ${k}'s top ${fmt(label[1])} is not 27 u below dot ${k}'s bottom ${fmt(y1(dot))}`);
      if (Math.abs(cx(label) - cx(dot)) > PX) failures.push(`label ${k} is not centred under dot ${k}: ${fmt(cx(label))} against ${fmt(cx(dot))}`);
      if (Math.abs(cx(back) - cx(label)) > PX || Math.abs(cy(back) - cy(label)) > PX) failures.push(`background ${k}'s centre (${fmt(cx(back))}, ${fmt(cy(back))}) is not label ${k}'s (${fmt(cx(label))}, ${fmt(cy(label))})`);
      if (Math.abs(back[2] - 360) > PX || Math.abs(back[3] - 40) > PX) failures.push(`background ${k} was resized to ${fmtBox(back)}`);
      failures.push(...inkInsideFailures(image!, isInk, label, `label ${k}`, 6));
    }
    none(failures, 'the positions figure');
  }, TIMEOUT);

  it('Proof: the quadratic formula\'s labels sit beside their parts (beside quad#disc and quad#pm on n, quad#den on s) at their gaps, centred, and draw inside their boxes', () => {
    const doc = loadDoc('quadratic.json', store);
    expectClean([doc], store);
    const quad = one(doc, 'quad');
    const part = (id: string): [number, number, number, number] => {
      const p = quad.parts.find((x) => x.id === id);
      expect(p, `the formula has the part ${id}: ${quad.parts.map((x) => x.id).join(', ')}`).toBeDefined();
      return p!.box;
    };
    const [image] = rasterAll(pngs, [doc], store);
    const failures: string[] = [];
    for (const [label, of, side, gap] of [['disc-label', 'disc', 'n', 16], ['pm-label', 'pm', 'n', 40], ['den-label', 'den', 's', 12]] as const) {
      const b = one(doc, label).box; const p = part(of);
      const got = side === 'n' ? p[1] - y1(b) : b[1] - y1(p);
      if (Math.abs(got - gap) > PX) failures.push(`${label} is ${fmt(got)} u from quad#${of}'s ${side} side, not ${gap}`);
      if (Math.abs(cx(b) - cx(p)) > PX) failures.push(`${label} is not centred on quad#${of}: ${fmt(cx(b))} against ${fmt(cx(p))}`);
      failures.push(...inkInsideFailures(image!, isAccent, b, label, 6));
    }
    // The parts are where the item draws them: at.pos (400, 280) and twice the SVG's units.
    const den = part('den');
    if ([400 + 120, 280 + 104, 80, 48].some((v, i) => Math.abs(v - den[i]!) > PX)) failures.push(`quad#den is at ${fmtBox(den)}, not [520, 384, 80, 48]`);
    if (x1(den) > x1(quad.box) + PX) failures.push('quad#den reaches past the formula\'s box');
    none(failures, 'the quadratic formula\'s labels');
  }, TIMEOUT);
});

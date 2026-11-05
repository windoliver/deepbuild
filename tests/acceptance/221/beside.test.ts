// AC1: "A formula (vector@1) beside a circle with side e, gap 24 and align center: at 120 sampled times while a keyed
// `at.pos` channel moves the circle, the formula's west side is 24 u ± 0.5 px from the circle's east side, and the two
// centres' y differ by at most 0.5 px"
//
// AC2: "A label beside a text patched to a string 40% longer keeps its 16 u gap within 0.5 px with no patch to the
// label"
//
// Oracle lane (README): ManimGX cfd33af5aa tests/unit/test_mobject.py:359-402 (TestBox: a box is the tight box
// measured on the curves, and a group's box joins its members') is ported onto AC1's formula and circle at every
// sampled time; :414-439 (test_next_to_leaves_buff_between_the_two: the facing sides are buff apart and the aligned
// edges match, in each direction and for each aligned edge) is ported onto AC2's text, before and after its patch.
import { describe, expect, it } from 'vitest';
import {
  EXACT, FLICKS, PX, TIMEOUT, clone, cx, cy, evenTimes, expectClean, fmt, fmtBox, geometryAt, geometryOf, inkInsideFailures, isAccent, isInk,
  itemOf, loadDoc, none, partsBox, rasterAll, scratch, boxFailures, tightBox, trackAt, trackOf, useRenderBinary, x1, y1, type Box, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const store = scratch('store');
const pngs = scratch('png');

describe('AC1 a formula beside a moving circle', () => {
  it('AC1 at 120 sampled times the formula\'s west side is 24 u ± 0.5 px from the circle\'s east side and the centres\' y differ by at most 0.5 px', () => {
    const doc = loadDoc('beside-formula.json', store);
    expectClean([doc], store);
    const times = evenTimes(4 * FLICKS, 120);
    const bx = trackOf(doc, 'ball-x');
    const by = trackOf(doc, 'ball-y');
    const formula = geometryAt(doc, 'formula', store, times);
    const failures: string[] = [];
    let moved = 0;
    formula.forEach((g, k) => {
      const t = times[k]!;
      // The circle's east side and centre, from its params and its keyed at.pos: geometry only (its 6 u stroke doesn't count).
      const east = 200 + 50 + trackAt(bx, t);
      const ballCy = 540 + trackAt(by, t);
      // The formula's box measured on the curves it draws at t: the join of its parts' tight boxes.
      const drawn = partsBox(g, `the formula at ${t} flicks`);
      const gap = drawn[0] - east;
      if (Math.abs(gap - 24) > PX) failures.push(`at ${t} flicks (${fmt(t / FLICKS)} s): the formula's west side ${fmt(drawn[0])} is ${fmt(gap)} u from the circle's east side ${fmt(east)}, not 24 ± ${PX}`);
      if (Math.abs(cy(drawn) - ballCy) > PX) failures.push(`at ${t} flicks: the formula's centre y ${fmt(cy(drawn))} differs from the circle's ${fmt(ballCy)} by ${fmt(cy(drawn) - ballCy)}, more than ${PX}`);
      if (k > 0 && Math.abs(drawn[0] - partsBox(formula[k - 1]!, 'the formula')[0]) > 1) moved += 1;
    });
    none(failures, 'the formula keeps its relation at every sampled time');
    // A relation solved once, at t = 0, leaves the formula where it was while the circle moves 900 u: it must follow.
    expect(moved, 'the formula moves with the circle across the sampled times').toBeGreaterThan(100);
  }, TIMEOUT);

  it('AC1 oracle port (TestBox, test_mobject.py:359-402): the formula\'s and the circle\'s box points are their tight boxes measured on the curves at every sampled time, the stroke left out', () => {
    const doc = loadDoc('beside-formula.json', store);
    const times = evenTimes(4 * FLICKS, 120);
    const bx = trackOf(doc, 'ball-x');
    const by = trackOf(doc, 'ball-y');
    const formula = geometryAt(doc, 'formula', store, times);
    const ball = geometryAt(doc, 'ball', store, times);
    const failures: string[] = [];
    formula.forEach((g, k) => {
      // A group's box joins its members' boxes, each the tight box of its curves (t-x is an O whose control points
      // reach 4 SVG units past its outline, 8 u at the formula's scale 2).
      failures.push(...boxFailures(g, partsBox(g, 'the formula'), EXACT, 'the formula'));
      for (const p of g.parts) {
        const tight = tightBox(p.subpaths);
        if (p.box.some((v, i) => Math.abs(v - tight[i]!) > EXACT)) failures.push(`the formula's part ${p.id} at ${g.t} flicks: box ${fmtBox(p.box)}, but its curves span ${fmtBox(tight)}`);
      }
      const t = times[k]!;
      const want: Box = [150 + trackAt(bx, t), 490 + trackAt(by, t), 100, 100];
      failures.push(...boxFailures(ball[k]!, want, EXACT, 'the circle (center 200, 540, r 50, its 6 u stroke not counted)'));
    });
    none(failures, 'box points from evaluated bounds');
  }, TIMEOUT);
});

/** AC2's two revisions: the document as written, and a whole revision whose text is patched to a string 40% longer, the label untouched. */
function revisions(): { before: JsonObject; after: JsonObject } {
  const before = loadDoc('beside-text.json');
  const after = clone(before);
  after['id'] = 'rel-221-beside-text-patched';
  const head = itemOf(after, 'head');
  const short = String((itemOf(before, 'head')['params'] as JsonObject)['text']);
  const long = 'Momentum of the cart at rest';
  expect(long.length / short.length, 'the patched string is 40% longer').toBe(1.4);
  (head['params'] as JsonObject)['text'] = long;
  expect(JSON.stringify(itemOf(after, 'unit')), 'no patch to the label').toBe(JSON.stringify(itemOf(before, 'unit')));
  return { before, after };
}

describe('AC2 a label beside a text that grows', () => {
  it('AC2 a label beside a text patched to a string 40% longer keeps its 16 u gap within 0.5 px with no patch to the label', () => {
    const { before, after } = revisions();
    expectClean([before, after], store);
    const [h0, h1] = geometryOf([before, after], 'head', store);
    const [u0, u1] = geometryOf([before, after], 'unit', store);
    const failures: string[] = [];
    for (const [what, head, unit] of [['before the patch', h0!, u0!], ['after the patch', h1!, u1!]] as const) {
      const gap = unit.box[0] - x1(head.box);
      if (Math.abs(gap - 16) > PX) failures.push(`${what}: the label's west side ${fmt(unit.box[0])} is ${fmt(gap)} u from the text's east side ${fmt(x1(head.box))}, not the default 16 ± ${PX}`);
      if (Math.abs(cy(unit.box) - cy(head.box)) > PX) failures.push(`${what}: the label's centre y ${fmt(cy(unit.box))} is not the text's ${fmt(cy(head.box))} (align: center, the default)`);
    }
    none(failures, 'the label keeps its gap');
    // The patch landed and the boxes are live: the text grew, and the label moved by what the text grew.
    expect(h1!.box[2], `the patched text is wider (${fmtBox(h0!.box)} then ${fmtBox(h1!.box)})`).toBeGreaterThan(1.25 * h0!.box[2]);
    expect(Math.abs((u1!.box[0] - u0!.box[0]) - (x1(h1!.box) - x1(h0!.box))), 'the label moved by the text\'s growth').toBeLessThanOrEqual(PX);
    // Render-back's boxes are where each draws: the text's ink (ink) and the label's (accent) lie inside their boxes.
    const [i0, i1] = rasterAll(pngs, [before, after], store);
    none([
      ...inkInsideFailures(i0!, isInk, h0!.box, 'the text before the patch'), ...inkInsideFailures(i0!, isAccent, u0!.box, 'the label before the patch'),
      ...inkInsideFailures(i1!, isInk, h1!.box, 'the text after the patch'), ...inkInsideFailures(i1!, isAccent, u1!.box, 'the label after the patch'),
    ], 'the boxes are where the items draw');
  }, TIMEOUT);

  it('AC2 oracle port (test_next_to_leaves_buff_between_the_two, test_mobject.py:414-439): a rect beside the text on each side with each aligned edge has its facing side gap apart and its aligned edge on the text\'s, before and after the patch', () => {
    const { before, after } = revisions();
    const sides = ['e', 'w', 'n', 's'] as const;
    const aligns = ['start', 'center', 'end'] as const;
    const gaps = [0, 7.5, 31];
    const docs: JsonObject[] = [];
    const cases: { side: (typeof sides)[number]; align: (typeof aligns)[number]; gap: number; base: 'before' | 'after' }[] = [];
    for (const base of ['before', 'after'] as const) {
      sides.forEach((side, i) => aligns.forEach((align, j) => {
        const gap = gaps[(i + j) % gaps.length]!;
        const doc = clone(base === 'before' ? before : after);
        doc['id'] = `rel-221-next-to-${base}-${side}-${align}`;
        const items = doc['items'] as JsonObject;
        delete items['unit'];
        items['mark'] = { id: 'mark', kind: 'rect@1', layer: 'main', name: 'Mark', order: 'a3', at: { place: { beside: 'head', side, gap, align } }, params: { box: [0, 0, 50, 20], paint: { fill: { role: 'accent' } } } };
        docs.push(doc);
        cases.push({ side, align, gap, base });
      }));
    }
    expectClean(docs, store);
    const heads = geometryOf(docs, 'head', store);
    const marks = geometryOf(docs, 'mark', store);
    const failures: string[] = [];
    cases.forEach((c, k) => {
      const a = marks[k]!.box; const b = heads[k]!.box;
      const what = `${c.base} the patch, side ${c.side}, align ${c.align}, gap ${c.gap}`;
      if (Math.abs(a[2] - 50) > PX || Math.abs(a[3] - 20) > PX) failures.push(`${what}: the rect was resized to ${fmtBox(a)}`);
      const gap = c.side === 'e' ? a[0] - x1(b) : c.side === 'w' ? b[0] - x1(a) : c.side === 's' ? a[1] - y1(b) : b[1] - y1(a);
      if (Math.abs(gap - c.gap) > PX) failures.push(`${what}: the facing sides are ${fmt(gap)} apart`);
      const across = c.side === 'e' || c.side === 'w'
        ? { start: [a[1], b[1]], center: [cy(a), cy(b)], end: [y1(a), y1(b)] }[c.align]
        : { start: [a[0], b[0]], center: [cx(a), cx(b)], end: [x1(a), x1(b)] }[c.align];
      if (Math.abs(across[0]! - across[1]!) > PX) failures.push(`${what}: the aligned edges are at ${fmt(across[0]!)} and ${fmt(across[1]!)}`);
    });
    none(failures, 'next_to leaves the gap between the two and lines up the aligned edge');
  }, TIMEOUT);
});

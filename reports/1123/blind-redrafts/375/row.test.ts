import { describe, expect, it } from 'vitest';
import { boxOf, bottom, children, fixedSize, fixture, near, params, solve, useBinaries, TOL } from './helpers.ts';

useBinaries('deep-layout');

const DOC = fixture('row.doc.json');
const FRAME = 'strip';
const GAP = 24;

describe('AC1 six children 40 to 120 u wide in a row with gap 24 and align_cross end share one bottom line within 0.5 px, the row the sum of their widths + 5 × 24 u wide within 0.5 px', () => {
  it('AC1 the fixture is six fixed children 40 to 120 u wide, of different heights, in a row with gap 24 and align_cross end', () => {
    const frame = params(DOC, FRAME);
    expect([frame['layout'], frame['gap'], frame['align_cross'], frame['padding'] ?? 0], 'a row, gap 24, align_cross end, no padding').toEqual(['row', GAP, 'end', 0]);
    const kids = children(DOC, FRAME);
    expect(kids.length, 'six children').toBe(6);
    const sizes = kids.map((id) => fixedSize(DOC, id));
    expect(Math.min(...sizes.map((s) => s.w)), 'the narrowest is 40 u').toBe(40);
    expect(Math.max(...sizes.map((s) => s.w)), 'the widest is 120 u').toBe(120);
    // Different heights, so a row aligned start or center has no shared bottom line.
    expect(new Set(sizes.map((s) => s.h)).size, 'six different heights').toBe(6);
  });

  it('AC1 the six share one bottom line within 0.5 px, in order with gap 24, and the row is the sum of their widths + 5 × 24 u wide', () => {
    const boxes = solve(DOC, 'the row');
    const kids = children(DOC, FRAME);
    const frame = boxOf(boxes, FRAME, 'the row');
    const sizes = kids.map((id) => fixedSize(DOC, id));
    let x = frame.x;
    for (const [i, id] of kids.entries()) {
      const b = boxOf(boxes, id, 'the row');
      // A stretched child (all as tall as the tallest) would share a bottom line too; its height fails here.
      near(b.w, sizes[i]!.w, `${id} keeps its fixed width`);
      near(b.h, sizes[i]!.h, `${id} keeps its fixed height`);
      // Children in order key order, left to right, 24 u apart: a layout that ignores the gap fails here.
      near(b.x, x, `${id} (child ${i + 1}) sits ${i === 0 ? 'at the row\'s start' : `${GAP} u right of ${kids[i - 1]}`}`);
      x += sizes[i]!.w + GAP;
    }
    const bottoms = kids.map((id) => bottom(boxOf(boxes, id, 'the row')));
    // align_cross start or center leaves these six heights on six bottom lines.
    expect(Math.max(...bottoms) - Math.min(...bottoms) <= TOL, `the six bottoms are on one line within ${TOL} px: ${JSON.stringify(Object.fromEntries(kids.map((id, i) => [id, bottoms[i]])))}`).toBe(true);
    const sum = sizes.reduce((total, s) => total + s.w, 0);
    near(frame.w, sum + 5 * GAP, `the row is the sum of the widths (${sum}) + 5 × 24 u wide`);
  });
});

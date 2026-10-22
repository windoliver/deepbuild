import { describe, expect, it } from 'vitest';
import { boxOf, children, fixedSize, fixture, near, params, right, solve, useBinaries, TOL, type Box } from './helpers.ts';

useBinaries('deep-layout');

const DOC = fixture('grid.doc.json');
const ROW_DOC = fixture('row.doc.json');
const FRAME = 'tiles';
const GAP = 24;
const ROWS = 2;
const COLS = 3;

/** Where flow by column puts child i (0-based): down column 1's two rows, then column 2's, then column 3's. */
const cellOf = (i: number): { row: number; col: number } => ({ row: i % ROWS, col: Math.floor(i / ROWS) });

/**
 * The grid's tracks as its fields define them: each hug column as wide as its widest child, each hug
 * row as tall as its tallest, 24 u between tracks, from the frame's top left (no padding).
 */
function tracks(frame: Box): { cols: { x: number; w: number }[]; rows: { y: number; h: number }[] } {
  const sizes = children(DOC, FRAME).map((id) => fixedSize(DOC, id));
  const colW = Array.from({ length: COLS }, (_, c) => Math.max(...sizes.filter((_, i) => cellOf(i).col === c).map((s) => s.w)));
  const rowH = Array.from({ length: ROWS }, (_, r) => Math.max(...sizes.filter((_, i) => cellOf(i).row === r).map((s) => s.h)));
  let x = frame.x;
  const cols = colW.map((w) => { const t = { x, w }; x += w + GAP; return t; });
  let y = frame.y;
  const rows = rowH.map((h) => { const t = { y, h }; y += h + GAP; return t; });
  return { cols, rows };
}

describe('AC1 the same six in a grid with cols: [hug, hug, hug], flow: column and align_cols: [start, center, end] put the second child in row 2, column 1, and column 3\'s east sides on one line within 0.5 px', () => {
  it('AC1 the fixture is the row\'s six children in a grid of three hug columns, flowed by column, aligned start, center and end', () => {
    const frame = params(DOC, FRAME);
    expect(frame['layout'], 'a grid').toBe('grid');
    expect(frame['grid'], 'two hug rows, three hug columns, flow by column, columns aligned start, center, end').toEqual({
      rows: ['hug', 'hug'], cols: ['hug', 'hug', 'hug'], flow: 'column', align_cols: ['start', 'center', 'end'],
    });
    expect(frame['gap'], 'gap 24').toBe(GAP);
    const kids = children(DOC, FRAME);
    expect(kids, 'the same six children in the same order as the row').toEqual(children(ROW_DOC, 'strip'));
    expect(kids.map((id) => fixedSize(DOC, id)), 'the same sizes as the row\'s').toEqual(kids.map((id) => fixedSize(ROW_DOC, id)));
    // Column 3's two children differ in width, so start or center leaves their east sides apart.
    const third = kids.filter((_, i) => cellOf(i).col === 2).map((id) => fixedSize(DOC, id).w);
    expect(new Set(third).size, 'column 3 holds two widths').toBe(2);
  });

  it('AC1 flow by column puts the second child in row 2, column 1, and every child in its cell', () => {
    const boxes = solve(DOC, 'the grid');
    const kids = children(DOC, FRAME);
    const { cols, rows } = tracks(boxOf(boxes, FRAME, 'the grid'));
    for (const [i, id] of kids.entries()) {
      const b = boxOf(boxes, id, 'the grid');
      const size = fixedSize(DOC, id);
      near(b.w, size.w, `${id} keeps its fixed width`);
      near(b.h, size.h, `${id} keeps its fixed height`);
      const { row, col } = cellOf(i);
      const c = cols[col]!;
      const r = rows[row]!;
      // A grid flowed by row puts the second child in row 1, column 2: its box lies outside this cell.
      const inside = b.x >= c.x - TOL && right(b) <= c.x + c.w + TOL && b.y >= r.y - TOL && b.y + b.h <= r.y + r.h + TOL;
      expect(inside, `child ${i + 1} (${id}) sits in row ${row + 1}, column ${col + 1}, the cell [${c.x}, ${r.y}, ${c.w}, ${r.h}]; its box is [${b.x}, ${b.y}, ${b.w}, ${b.h}]`).toBe(true);
    }
  });

  it('AC1 column 3 is end-aligned: its children\'s east sides are on one line within 0.5 px, the column\'s east edge', () => {
    const boxes = solve(DOC, 'the grid');
    const kids = children(DOC, FRAME);
    const { cols } = tracks(boxOf(boxes, FRAME, 'the grid'));
    const third = kids.filter((_, i) => cellOf(i).col === 2);
    const east = third.map((id) => right(boxOf(boxes, id, 'the grid')));
    // Centered, the narrower child's east side sits half the width difference short; started, all of it.
    expect(Math.max(...east) - Math.min(...east) <= TOL, `column 3's east sides are on one line within ${TOL} px: ${JSON.stringify(Object.fromEntries(third.map((id, i) => [id, east[i]])))}`).toBe(true);
    for (const [i, id] of third.entries()) near(east[i]!, cols[2]!.x + cols[2]!.w, `${id}'s east side is column 3's east edge`);
  });
});

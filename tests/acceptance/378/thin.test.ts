// #378.cbedd951: a 3D line requested at 0.25 px draws at one pixel with its alpha scaled to 0.25, within 5%.
// fixtures/thin-lines.json: three horizontal 3D lines in px, each centred on a pixel row of an orthographic
// view (40 px per m): `quarter` at 0.25 px on row 300, `half` at 0.5 px on row 200 and `full` at 1 px on row
// 400, over the look's black ground. Read from the frame's linear target, where a line's coverage of a pixel
// is (value − ground) ÷ (the 1 px line's value − ground). The check's own twins: the 1 px line and the
// 0.5 px line, run through the same 0.25 check, fail it. At the base `deep-gpu` answers the view3d call
// with bad_input.
import { describe, expect, it } from 'vitest';
import { GPU_BIN, fixturePath, frameAt, look, readLinear, requireGpu, runGpu, useBins, useOut, view3d, view3Reply } from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const SIZE: [number, number] = [800, 600];
const ROWS = { quarter: 300, half: 200, full: 400 } as const;
const COLUMNS: [number, number] = [120, 680]; // inside the lines, which run from x 80 to 720, clear of their caps
const TOLERANCE = 0.05;

/** The red channel of the linear target at (x, y): the lines and the ground are grey. */
const at = (lin: Float32Array, x: number, y: number): number => lin[(y * SIZE[0] + x) * 4]!;

/** A line on `row` covers that one row with `alpha` within 5% in every column, and the rows beside it with at most 5% of `alpha`. */
function coverageProblems(lin: Float32Array, row: number, alpha: number, what: string): string[] {
  const ground = at(lin, 400, 100);
  const full = (x: number): number => at(lin, x, ROWS.full) - ground;
  const problems: string[] = [];
  let off = 0; let bleed = 0; let first = ''; let firstBleed = ''; let sum = 0;
  for (let x = COLUMNS[0]; x < COLUMNS[1]; x++) {
    const c = (at(lin, x, row) - ground) / full(x);
    sum += c;
    if (Math.abs(c - alpha) > TOLERANCE * alpha) { off++; if (!first) first = `column ${x} covers ${c.toFixed(4)}`; }
    for (const y of [row - 1, row + 1]) {
      const b = (at(lin, x, y) - ground) / full(x);
      if (b > TOLERANCE * alpha) { bleed++; if (!firstBleed) firstBleed = `(${x}, ${y}) covers ${b.toFixed(4)}`; }
    }
  }
  const n = COLUMNS[1] - COLUMNS[0];
  if (off) problems.push(`${what}: ${off} of ${n} columns of row ${row} are not ${alpha} within 5% (mean ${(sum / n).toFixed(4)}; first ${first})`);
  if (bleed) problems.push(`${what}: the line spreads past one pixel: ${bleed} pixels on the rows beside ${row} carry more than 5% of ${alpha} (first ${firstBleed})`);
  return problems;
}

describe('#378.cbedd951 a 3D line requested at 0.25 px draws at one pixel with its alpha scaled to 0.25, within 5%', () => {
  it('#378.cbedd951 the 0.25 px line covers its one row at 0.25 within 5% in every column, the 0.5 px line at 0.5, and neither spreads to the rows beside it; the check fails the 1 px and 0.5 px lines as 0.25 px lines', () => {
    requireGpu();
    const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: fixturePath('thin-lines.json'), look: look(), size: SIZE, targets: ['linear'], capture: [0] })]);
    const f = frameAt(view3Reply(reply!, 'the thin-lines fixture'), 0, 'the thin-lines fixture');
    const lin = readLinear(out(), f.linear, SIZE, 'frame 0\'s linear target');
    const ground = at(lin, 400, 100);
    // The reference: the 1 px line draws its row fully, well above the ground, and nothing beside it.
    for (let x = COLUMNS[0]; x < COLUMNS[1]; x += 40) {
      expect(at(lin, x, ROWS.full) - ground, `the 1 px line draws at (${x}, ${ROWS.full}), above the ground`).toBeGreaterThan(0.5);
      expect(Math.abs(at(lin, x, ROWS.full - 1) - ground), `the 1 px line leaves row ${ROWS.full - 1} at the ground`).toBeLessThan(0.005);
    }
    expect(coverageProblems(lin, ROWS.quarter, 0.25, 'the 0.25 px line'), 'the 0.25 px line').toEqual([]);
    expect(coverageProblems(lin, ROWS.half, 0.5, 'the 0.5 px line'), 'the 0.5 px line (alpha scales with the width)').toEqual([]);
    // The check's twins: a line drawn at full alpha, or at the wrong scale, fails the 0.25 check.
    expect(coverageProblems(lin, ROWS.full, 0.25, 'the 1 px line as a 0.25 px line').length, 'the 1 px line fails the 0.25 check').toBeGreaterThan(0);
    expect(coverageProblems(lin, ROWS.half, 0.25, 'the 0.5 px line as a 0.25 px line').length, 'the 0.5 px line fails the 0.25 check').toBeGreaterThan(0);
  }, 600_000);
});

// AC1 #1967, against a live grid: "… and its grid at 1.0 s equals a live grid fed the same bytes up to 1.0 s". The
// live grid is #402's: a terminal in a plug-in's panel, fed the recording's chunks up to 1.0 s on the virtual display
// clock, read at 1.0 s after its output starts with `cells` and a `cell` call for each of its 80 cells. The recording's
// grid is the one `determinism` answers when playing and when seeking to 1.0 s (play.test.ts). Equal means the same
// size, rows, cursor (place, shape, visibility, blink) and every cell's grapheme, colors, attributes and link. Three
// more live grids show the comparison sees each of those: the same text without its pen, the bytes up to 2.0 s, and
// the same bytes then the cursor moved. Wrong programs: the base (no grid plays a recording); any grid that differs
// from the live one in a cell, a row or the cursor, as those three do.
import { describe, expect, it } from 'vitest';
import {
  CHUNKS, PEN_1, STEP_1, STEP_2, TIMEOUT, TIMES, at, fl, gridDiffs, penProblems, playAndSeek, runLive, shownProblems, useShow, useTemp,
} from './helpers.ts';

const shows = useShow();
const temp = useTemp();
const ONE = fl(1);

describe('AC1 a terminal recording played in a cell grid, against a live grid', () => {
  it('AC1 the grid at 1.0 s, played and seeked, equals a live terminal\'s grid fed the same bytes up to 1.0 s, cell for cell, row for row and in its cursor; the same comparison tells apart a live grid without the pen, one fed past 1.0 s and one whose cursor moved', () => {
    const live = runLive(shows(), temp(), {
      same: CHUNKS.filter((c) => c.at <= ONE),
      no_pen: [{ at: fl(0.5), text: 'step 1\r\n' }],
      past: [{ at: fl(0.5), text: `${STEP_1}${STEP_2}` }],
      moved: [{ at: fl(0.5), text: `${STEP_1}\u001b[1;5H` }],
    }, ONE);
    const same = live['same']!;
    // The live grid is what the bytes make, so equal to it isn't equal to nothing.
    expect(shownProblems(same, TIMES.find((e) => e.t === ONE)!, 'the live grid'), 'the live grid shows step 1').toEqual([]);
    expect(penProblems(same, 0, 'step 1', PEN_1, 'underline', 'the live grid'), 'in the pen it was printed with').toEqual([]);
    // The comparison sees the pen, the rows and the cursor, not the text alone.
    const noPen = gridDiffs(live['no_pen']!, same);
    expect(noPen.length > 0 && noPen.every((d) => d.startsWith('cell (')), `a live grid of the same text without its pen differs in its cells only: ${JSON.stringify(noPen.slice(0, 4))}`).toBe(true);
    expect(noPen.some((d) => d.startsWith('cell (0, 0) attrs')), 'naming the first cell\'s attributes').toBe(true);
    const past = gridDiffs(live['past']!, same);
    expect(past.some((d) => d.startsWith('row 1 text')), `a live grid fed past 1.0 s differs in row 1: ${JSON.stringify(past.slice(0, 4))}`).toBe(true);
    const moved = gridDiffs(live['moved']!, same);
    expect(moved.length > 0 && moved.every((d) => d.startsWith('cursor.')), `a live grid whose cursor moved differs in its cursor only: ${JSON.stringify(moved)}`).toBe(true);
    // The recording's grid at 1.0 s, played and seeked, against the live grid.
    const one = at(playAndSeek(shows(), temp(), undefined, [ONE]), ONE);
    expect(gridDiffs(one.play.grid, same), 'played to 1.0 s, the grid equals the live grid fed the bytes up to 1.0 s').toEqual([]);
    expect(gridDiffs(one.seek.grid, same), 'seeked to 1.0 s, the grid equals the live grid fed the bytes up to 1.0 s').toEqual([]);
  }, TIMEOUT);
});

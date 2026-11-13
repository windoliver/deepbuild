// #408.78b2fa37: "A title past both edges by 182 u from 2 s to 3 s reports one layout.cut with both times and a fix that
// scales it to the safe width, and applying the fix passes; a plot leaving the frame is a notice and the check passes"
//
// Fixtures (helpers.ts), 1920 × 1080 films with the default safe area (24 u, so a safe width of 1,872 u):
//   - `cutFilm`, cue ends 1, 2, 3 and 4 s: the title, a vector@1 whose one part fills its 2284 × 200 u box, at
//     x = −182, so 182 u past the frame's left and right edges; a hold-keyed channel holds it wholly above the frame
//     until 2 s, at y = 300 from 2 s, and above the frame again from 3.5 s, so it is in the frame at the cue ends 2 and
//     3 s only (wholly out of frame is a notice, never an error: Film layout);
//   - `plotFilm`, cue ends 1 and 2 s: an open path@1 plot from (200, 800) leaving the frame past its right edge.
//
// asserts, in a first run on this Mac: deep_query reads the title's evaluated bounds at 2 s as x −182 to 2102, y 300 to
// 500 (the fixture is what the criterion says); the title's film FAILs with exactly one layout.cut, an error, naming the
// title, its sides two different edges each passed by 182 u (± 0.05), t = 2 s and ts = [2, 3] s, and a fix as patch
// ops; the plot's film PASSes, and a notice names the plot, nothing worse. In a second run, from the same stored title
// film: the fix's ops, applied as one patch by you on revision 0, apply; the requirement then PASSes with nothing
// raised; and deep_query reads the title's width at 2 s as the safe width, 1,872 u, allowing up to cut_min (2.7 u)
// inside each side.
import { describe, expect, it } from 'vitest';
import {
  AC, CUT_TIMES, FULL, PLOT, SAFE_WIDTH, TIMEOUT, TITLE, TITLE_SIZE, blockSvg, boundsOf, boundsQuery, cutFailures, cutFilm, docId, fixPatch, judge,
  none, noticeFailures, passFailures, plotFilm, putStore, useBuilds, useFolders, type Film,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const CUT_MIN = 2.7;

describe(`${AC[3]} a title past both edges is one layout.cut whose fix scales it to the safe width; a plot leaving the frame is a notice`, () => {
  it(`${AC[3]} the title 182 u past both edges from 2 s to 3 s is one layout.cut with both times and a scale-to-safe-width fix that passes once applied; the plot leaving the frame is a notice and passes`, () => {
    const first = folder();
    const title: Film = { name: 'the title past both edges', doc: docId(1), document: cutFilm(docId(1), putStore(first, blockSvg(...TITLE_SIZE, 'words'))) };
    const plot: Film = { name: 'the plot leaving the frame', doc: docId(2), document: plotFilm(docId(2)) };
    const one = judge(bin(FULL), first, [title, plot], { after: [boundsQuery(title.doc, TITLE, '2s')] });
    const [x0, y0, x1, y1] = boundsOf(one.replies[2]!, TITLE, 'the title at 2 s');
    for (const [got, want, what] of [[x0, -182, 'left'], [x1, 2102, 'right'], [y0, 300, 'top'], [y1, 500, 'bottom']] as const) {
      expect(Math.abs(got - want), `the fixture: the title's ${what} edge at 2 s is at ${want} u, read ${got}`).toBeLessThanOrEqual(0.01);
    }
    const cut = cutFailures(one.rows[title.name], TITLE, 182, 2, CUT_TIMES);
    none(cut.failures, title.name);
    none([...passFailures(one.rows[plot.name], plot.name), ...noticeFailures(one.rows[plot.name], PLOT)], plot.name);

    const second = folder();
    putStore(second, blockSvg(...TITLE_SIZE, 'words'));
    const two = judge(bin(FULL), second, [title], { before: [fixPatch(title.doc, cut.ops!)], after: [boundsQuery(title.doc, TITLE, '2s')] });
    expect(two.replies[0]!['outcome'], `the fix's ops apply as your patch: ${JSON.stringify(two.replies[0]).slice(0, 1500)}`).toBe('applied');
    none(passFailures(two.rows[title.name], 'the title with its fix applied'), 'applying the fix passes');
    const [a, , b] = boundsOf(two.replies[2]!, TITLE, 'the fixed title at 2 s');
    expect(b - a, `the fix scales the title to the safe width, ${SAFE_WIDTH} u (less at most ${CUT_MIN} u a side): it spans ${a} to ${b}`).toBeGreaterThanOrEqual(SAFE_WIDTH - 2 * CUT_MIN);
    expect(b - a, `the fixed title is no wider than the safe width, ${SAFE_WIDTH} u: it spans ${a} to ${b}`).toBeLessThanOrEqual(SAFE_WIDTH + 0.05);
  }, TIMEOUT);
});

// AC7 #142.58304480: "In explain.linear_map, apply [[1, 1], [0, 1]] leaves î at (1, 0) and ĵ at (1, 1) within 1e-9 at the
// end and ĵ at (0.5, 1) at the middle, and the area readout shows 1.00 through the shear and 2.00 after [[2, 0], [0, 1]]"
//
// A linear_map film on the 2D stage (README: Fixtures): the plane x −4…4, y −3…3, the basis and the unit square on,
// a tempo map of 120 BPM; cues `shear`, explain.apply [[1, 1], [0, 1]] over 0–1 s, then `stretch`, explain.apply
// [[2, 0], [0, 1]] over 1–2 s (matrices by rows). Read through the recipe's derived items (README: explain.linear_map):
//   - î and ĵ (`film.i_hat`, `film.j_hat`): #223's `path` at t answers each arrow as drawn, in document u; its tip is
//     the drawn point farthest from the plane's origin, read in plane coordinates through the moving plane's warp
//     (`film.moving`'s `plane`). At 1 s, the shear's end: î at (1, 0) and ĵ at (1, 1), within 1e-9. At 0.5 s, its
//     middle: ĵ at (0.5, 1) within 1e-9 (the warp mixes the matrix, (1 − u)I + uM, so a straight path, not an arc).
//   - The area readout (`film.area`): `eval` with `texts` gives its shown string, whose one two-decimal number reads
//     1.00 at every frame from 0 to 1 s, and 2.00 at 2 s and at 2.5 s.
// Wrong programs: the base (no recipe); a matrix read by columns (î to (1, 1), ĵ left at (0, 1)); a turn along an arc
// (ĵ off (0.5, 1) at the middle); a readout at another precision, or one not driven by M (1.00 after the stretch).
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, INSTANCE, LM, TIMEOUT, apply, brief, docId, errors, evalAt, expansionOf, linearFilm, none, pathAt, planeOf, pointsOf, present,
  readings, run, scenario, showTime, textsOf, tipOf, useFolders, useShow, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const FRAME = FLICKS / 60;
const film = linearFilm('A shear, then a stretch', [apply('shear', [[1, 1], [0, 1]]), apply('stretch', [[2, 0], [0, 1]])]);
const SHEAR = Array.from({ length: 61 }, (_, k) => k * FRAME);
const AFTER = [2 * FLICKS, 2.5 * FLICKS];

describe(`${AC[7]} explain.linear_map's shear and its area readout`, () => {
  it(`${AC[7]} apply [[1, 1], [0, 1]] leaves î at (1, 0) and ĵ at (1, 1), ĵ at (0.5, 1) at the middle, and the readout shows 1.00 through it and 2.00 after [[2, 0], [0, 1]]`, () => {
    const calls: JsonObject[] = [
      present(docId(1), film),
      pathAt(docId(1), LM.i, FLICKS), pathAt(docId(1), LM.j, FLICKS), pathAt(docId(1), LM.j, FLICKS / 2),
      ...[...SHEAR, ...AFTER].map((t) => evalAt(docId(1), t, { texts: true })),
    ];
    const replies = run(show(), scenario(folder(), calls));
    const shown = replies[0]!;
    expect(shown['outcome'] === 'presented' && errors(shown).length === 0, `the linear_map film is presented with no error: ${brief(shown, 1500)}`).toBe(true);
    const plane = planeOf(expansionOf(shown, INSTANCE, 'the linear_map film'), 'the linear_map film');
    const failures: string[] = [];
    const tips: [string, number, [number, number]][] = [['î', 1, [1, 0]], ['ĵ', 2, [1, 1]], ['ĵ', 3, [0.5, 1]]];
    for (const [name, k, want] of tips) {
      const when = k === 3 ? 'at 0.5 s, the shear\'s middle' : 'at 1 s, the shear\'s end';
      const points = pointsOf(replies[k]!);
      if (!points || !points.length) { failures.push(`${name} ${when}: path answers no outline: ${brief(replies[k]!, 600)}`); continue; }
      const tip = tipOf(plane, points);
      if (!(Math.abs(tip[0] - want[0]) <= 1e-9 && Math.abs(tip[1] - want[1]) <= 1e-9)) failures.push(`${name} ${when}: its tip is at (${tip[0]}, ${tip[1]}), not (${want[0]}, ${want[1]}) within 1e-9`);
    }
    [...SHEAR, ...AFTER].forEach((t, k) => {
      const want = t <= FLICKS ? '1.00' : '2.00';
      const shownText = textsOf(replies[4 + k]!, `the readout at ${showTime(t)}`)[LM.area];
      const got = typeof shownText === 'string' ? readings(shownText) : [];
      if (got.length !== 1 || got[0] !== want) failures.push(`the area readout at ${showTime(t)} shows ${brief(shownText ?? null)}, not ${want}`);
    });
    none(failures, 'the basis and the area readout through the shear and the stretch');
  }, TIMEOUT);
});

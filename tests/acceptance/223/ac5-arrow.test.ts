// AC5 #223.3a3308e4: "An arrow under a shear keeps its tip's length within 0.5 px and its angle to the mapped tangent
// within 0.5° with `ends: redraw`; with `ends: warp` the tip shears"
//
// The arrow: `arrow`, the path M 400 400 L 400 200 (the plane's y axis from (0, −1) to (0, 1)), stroked 3 u, with
// `ends: {end: arrow, size: 4}` (#160's: a 12 × 12 u head on a long path), a child of group `g` on the plane of origin
// (400, 300) u, unit 100 u, y up, warped by the shear `linear {matrix: [[1, 1], [0, 1]]}` at mix 1 (x' = x + y), with
// `ends: redraw` or `ends: warp`; the same arrow in a plain group is the twin. Read through `deep-canvas-render path`'s
// `ends.end` (#160's `{kind, tip, angle, length, width}`, and `outline`, which this suite adds: the head's drawn
// outline, its corners in document u).
// With `ends: redraw`: the tip lies at the sheared end, (500, 200) u, within 0.5 u; its angle is the sheared arriving
// tangent's, the plane's (0, 1) sheared to (1, 1), −45° in document u, within 0.5°; its length is the twin's within
// 0.5 u (px at zoom 1).
// With `ends: warp`: the head's outline is the twin's outline sheared, within 0.5 u both ways, and differs from the
// redrawn head's by more than 0.5 u somewhere: the tip shears.
// Wrong programs: the base (no warp: the tip at (400, 200), pointing −90°); a head mapped with the path under `redraw`
// (its length becomes 12√2 along the sheared tangent); a head drawn along the unmapped tangent; `ends: warp` drawn as
// `redraw` (no shear), or the reverse.
import { describe, expect, it } from 'vitest';
import {
  AC, PLANE, SHEAR, TIMEOUT, angleDiff, angleOf, arrowDoc, bothWays, dist, expectClean, mat, onScreen, firstFrames, short, sub2, toPlane, toScreen,
  useBins, vertices, type End, type PathFrame, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);
const shear = onScreen(PLANE, (q) => mat(SHEAR, q));
const PLAIN = arrowDoc('warp-arrow-plain', null);
const REDRAW = arrowDoc('warp-arrow-redraw', 'redraw');
const WARP = arrowDoc('warp-arrow-warp', 'warp');

function endOf(f: PathFrame | undefined, what: string): End {
  const e = f?.ends?.['end'];
  expect(e, `${what}: the path reports its end's head (ends.end)`).toBeDefined();
  expect(e!.kind, `${what}: the end's head is an arrow`).toBe('arrow');
  return e!;
}
function outlineOf(e: End, what: string): Pt[] {
  expect(e.outline !== null && e.outline.length >= 3, `${what}: the head reports its drawn outline (ends.end.outline), at least three corners`).toBe(true);
  return [...e.outline!, e.outline![0]!];
}
/** The sheared arriving tangent's angle at the twin's end, in document u. */
function mappedTangent(plain: PathFrame): { end: Pt; angle: number } {
  const v = vertices(plain.subpaths[0]!);
  const end = v[v.length - 1]!; const before = v[v.length - 2]!;
  const d = mat(SHEAR, sub2(toPlane(PLANE, end), toPlane(PLANE, before)));
  return { end: shear(end), angle: angleOf(sub2(toScreen(PLANE, d), toScreen(PLANE, [0, 0]))) };
}

describe(`${AC[5]} an arrow's head under a shear`, () => {
  it(`${AC[5]} with ends: redraw the head keeps its length within 0.5 px and lies along the mapped tangent within 0.5°`, () => {
    expectClean(bin('render'), REDRAW, 'the sheared arrow, ends redraw');
    const [plain, redraw] = firstFrames(bin('render'), [{ doc: PLAIN, item: 'arrow' }, { doc: REDRAW, item: 'arrow' }], 'the arrow, plain and redrawn');
    const own = endOf(plain, 'the plain arrow');
    const head = endOf(redraw, 'the sheared arrow, ends redraw');
    const want = mappedTangent(plain!);
    expect(dist(head.tip, want.end), `the redrawn tip sits at the sheared end (${want.end.map(short).join(', ')}), not (${head.tip.map(short).join(', ')})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(angleDiff(head.angle, want.angle)), `the redrawn head points along the sheared tangent, ${short(want.angle)}°, not ${short(head.angle)}°`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(head.length - own.length), `the redrawn head keeps its length, ${short(own.length)} u, not ${short(head.length)} u`).toBeLessThanOrEqual(0.5);
  }, TIMEOUT);

  it(`${AC[5]} with ends: warp the head shears with the path`, () => {
    expectClean(bin('render'), WARP, 'the sheared arrow, ends warp');
    const [plain, redraw, warped] = firstFrames(bin('render'), [{ doc: PLAIN, item: 'arrow' }, { doc: REDRAW, item: 'arrow' }, { doc: WARP, item: 'arrow' }], 'the arrow, plain, redrawn and warped');
    const own = outlineOf(endOf(plain, 'the plain arrow'), 'the plain arrow');
    const kept = outlineOf(endOf(redraw, 'the sheared arrow, ends redraw'), 'the sheared arrow, ends redraw');
    const sheared = outlineOf(endOf(warped, 'the sheared arrow, ends warp'), 'the sheared arrow, ends warp');
    const failures = bothWays([sheared], [own.map(shear)], 0.5, 'the head under ends: warp against the plain head sheared');
    expect(failures, `with ends: warp the head is the plain head sheared:\n  ${failures.join('\n  ')}`).toEqual([]);
    expect(bothWays([sheared], [kept], 0.5, 'warp against redraw').length, 'the warped head differs from the redrawn one: the tip shears').toBeGreaterThan(0);
  }, TIMEOUT);
});

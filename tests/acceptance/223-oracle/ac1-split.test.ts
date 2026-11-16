// AC1 #223.532d1014 (Oracle lane): a mapped path is cut the same way for every curve and stays within its tolerance all
// along. Ported from a fork of an upstream animation library, pinned at `cfd33af5aa`: tests/unit/test_mobject.py, lines
// 2479–2511, test_an_image_is_within_its_tolerance_all_along (README: Sources). No upstream code is copied.
//
// The upstream test applies three maps (waves, a square, a complex square) to random paths of up to three cubics, held
// alone and inside a group, and asserts every curve is cut into the same number of pieces and each piece, at 33 evenly
// spaced parameters, lies within 1.5 × the map's tolerance of the true image of the matching stretch of its curve
// (piece k of n at t is the curve at (k + t) ÷ n). Ours: a `path@1` of 1 to 3 random cubics (its points in the plane's
// [−2, 2]², drawn by a seeded generator, six paths per case) under group `g` warped by `map {x, y}` at mix 1 on the
// plane of origin (400, 300) u, unit 100 u, y up, its tolerance the default 0.5 px; held directly, or inside a plain
// group `inner` that `g` holds. The maps, in plane units: waves (x + 0.5 sin y, y + 0.5 sin x); square (x|x| ÷ 10, y);
// complex square ((x² − y²) ÷ 10, xy ÷ 5). Read through `deep-canvas-render path`: the warped sub-path has n × k
// cubics for the path's k, n a whole number; and each piece's 33 points lie within 0.75 u (1.5 × 0.5 px) of the
// true image.
// The planted fault: `path`'s planted `warp_maps_anchors_only` (the #223 suite's) on the same lines fails the port.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, PLANE, TIMEOUT, batch, bezier, dist, figure, item, none, onScreen, pathAccepted, pathItem, planeJson, randomCurves, segmentsOf, short,
  useBins, warpGroup, type Curves, type JsonObject, type JsonValue, type PathFrame, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);
const MAPS: { name: string; x: string; y: string; f: (q: Pt) => Pt }[] = [
  { name: 'waves', x: 'x + 0.5 * sin(y)', y: 'y + 0.5 * sin(x)', f: ([x, y]) => [x + 0.5 * Math.sin(y), y + 0.5 * Math.sin(x)] },
  { name: 'square', x: 'x * abs(x) / 10', y: 'y', f: ([x, y]) => [(x * Math.abs(x)) / 10, y] },
  { name: 'complex square', x: '(x * x - y * y) / 10', y: 'x * y / 5', f: ([x, y]) => [(x * x - y * y) / 10, (x * y) / 5] },
];
interface Case { what: string; map: (typeof MAPS)[number]; path: Curves; doc: JsonObject }
const CASES: Case[] = MAPS.flatMap((map) => [false, true].flatMap((grouped) => randomCurves(`#223 oracle split ${map.name} ${grouped}`, 6).map((path, i): Case => ({
  what: `${map.name}, ${grouped ? 'grouped' : 'alone'}, path ${i}`, map, path,
  doc: figure(`warp-oracle-split-${i}`, [800, 600], [
    warpGroup('g', { map: { x: map.x, y: map.y }, mix: 1, plane: planeJson(PLANE) }),
    ...(grouped ? [item('inner', 'group@1', 'a1', {}, { parent: 'g' })] : []),
    pathItem('curve', 'a2', path.d, 2, {}, { parent: grouped ? 'inner' : 'g' }),
  ]),
}))));

/** The port's judge on one case: one cut count for every curve, each piece within 0.75 u of the true image at 33 points. */
function judgeCase(c: Case, frame: PathFrame): string[] {
  const f = onScreen(PLANE, c.map.f);
  const pieces = frame.subpaths.flatMap(segmentsOf);
  const k = c.path.curves.length;
  const n = pieces.length / k;
  if (frame.subpaths.length !== 1 || !Number.isInteger(n) || n < 1) return [`${c.what}: ${pieces.length} pieces in ${frame.subpaths.length} sub-path(s) are not the path's ${k} curves each cut into one number of pieces`];
  const failures: string[] = [];
  c.path.curves.forEach((curve, ci) => {
    for (let j = 0; j < n; j++) {
      const piece = pieces[ci * n + j]!;
      let worst = 0;
      for (let s = 0; s <= 32; s++) { const t = s / 32; worst = Math.max(worst, dist(bezier(piece, t), f(bezier(curve, (j + t) / n)))); }
      if (worst > 0.75) failures.push(`${c.what}: curve ${ci}, piece ${j} of ${n} strays ${short(worst)} u from the true image`);
    }
  });
  return failures;
}
function judgeAll(planted?: string): string[] {
  const outs = batch(bin('render'), 'path', CASES.map((c) => ({ doc: c.doc, item: 'curve', look: LOOK, ...(planted ? { planted } : {}) }) as JsonValue));
  return CASES.flatMap((c, i) => judgeCase(c, pathAccepted(outs[i], [0], c.what)[0]!));
}

describe(`${AC[1]} (Oracle) a mapped path is cut one way for every curve and holds its tolerance all along`, () => {
  it(`${AC[1]} test_an_image_is_within_its_tolerance_all_along: waves, a square and a complex square on random paths, alone and grouped`, () => {
    none(judgeAll(), 'each mapped path is cut one way for every curve, each piece within 0.75 u of the true image');
  }, TIMEOUT);

  it(`${AC[1]} the port fails on the planted warp_maps_anchors_only`, () => {
    expect(judgeAll('warp_maps_anchors_only').length, 'the port fails on a warp that maps only the original anchors').toBeGreaterThan(0);
  }, TIMEOUT);
});

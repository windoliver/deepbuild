// AC4 #494.a4c0e37e: A formula A morphs into formula B inside one shot by `{of: B}` keys, reaching B's shape within
// 0.01 u at the last key; with `pairs: {#x: #y}` the part x reaches y's place within 0.5 u at the morph's end; with
// `unpaired: cross_fade` an unpaired outgoing part's opacity and the unpaired incoming part's sum to 1 ± 0.01 at every
// frame; and with `unpaired: split` one square on one side ends as three faded copies on the three squares the other
// side leaves unpaired.
//
// Through `deep-show run` (`full`), films of two vector@1 formulas over SVGs this suite writes (README: Formulas), both
// filling the page from the origin, so SVG units are document u and both share one space. The `{of}` half keys fa's
// path (`items/fa/path`, README: Path channel) from A's own outline, written out, at 0 s to `{of: "fb"}` at 1 s, and
// reads `film.paths.fa` (README: `paths`) at 1 s against B's outline: A and B have three parts each, of other shapes
// and point counts, so a path that never reaches B fails. The other three halves are match_morph transitions from fa to
// fb over [0 s, 1 s], read from `film.morphs` (README: `morphs`). The pairs fixture has a part x on both sides, so a
// program that ignores `pairs` sends x to B's x (its control shows that); the split fixture's squares differ in size
// from the one they split from, so no shape pairing takes them first (README: Choices).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, allPoints, boxCenter, channel, dist, film, filmsAt, fl, fmt, formula, frames60, key, matchMorph, none, obj, onePiece, pathValue,
  piecesOf, putStore, readPath, rectPoly, svgOf, toOutline, useEvidence, useShow, type JsonObject, type Part, type Poly, type V2,
} from './helpers.ts';

const shows = useShow();
const evidence = useEvidence();
const centreOf = (side: Part[], id: string): V2 => boxCenter(side.find((p) => p.id === id)!.poly);
/** A film of fa over A and fb over B, with the extra fields given. */
function pair(store: string, name: string, A: Part[], B: Part[], extra: JsonObject): JsonObject {
  return film(name, [formula('fa', putStore(store, svgOf(A)), 'A'), formula('fb', putStore(store, svgOf(B)), 'B')], extra);
}
const square = (x: number, y: number, side: number): Poly => rectPoly(x, y, x + side, y + side);

describe(`${AC[4]} one item morphs into another: {of} keys, pairs and what the unpaired parts do`, () => {
  it(`${AC[4]} formula A morphs into formula B by {of: B} keys, reaching B's shape within 0.01 u at the last key`, () => {
    const triangle: Poly = [[150, 100], [200, 180], [100, 180]];
    const pentagon: Poly = Array.from({ length: 5 }, (_, i) => [450 + 40 * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / 5), 150 + 40 * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / 5)] as V2);
    const A: Part[] = [{ id: 'p', poly: rectPoly(100, 250, 180, 290) }, { id: 'q', poly: triangle }, { id: 'r', poly: square(220, 240, 50) }];
    const B: Part[] = [{ id: 'p', poly: pentagon }, { id: 'q', poly: rectPoly(380, 260, 520, 280) }, { id: 'r', poly: [[600, 100], [700, 120], [680, 220], [620, 200], [590, 150], [610, 120]] }];
    const store = evidence();
    const doc = pair(store, 'of-b', A, B, {
      channels: { morph: channel('items/fa/path', 'path', [key(0, pathValue(A.map((p) => p.poly))), key(1, { of: 'fb' })]) },
    });
    const [last] = filmsAt(shows(), store, doc, [fl(1)], 'the {of: fb} morph');
    const subs = readPath(obj(last!['paths'], 'film.paths')['fa'], 'film.paths.fa at 1 s');
    const points = allPoints(subs);
    expect(subs.every((s) => s.closed), 'every sub-path of fa\'s path is closed at the last key').toBe(true);
    const off = points.filter((pt) => Math.min(...B.map((b) => toOutline(pt, b.poly))) > 0.01);
    expect(off.map(fmt), `at the last key every point of fa's path lies on B's outline within 0.01 u (${points.length} points)`).toEqual([]);
    const missed = B.filter((b) => points.filter((pt) => toOutline(pt, b.poly) <= 0.01).length < 3).map((b) => b.id);
    expect(missed, 'at the last key each of B\'s parts carries at least three of the points (B\'s whole shape is reached)').toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} with pairs: {#x: #y} the part x reaches y's place within 0.5 u at the morph's end, where without pairs it reaches B's x`, () => {
    const A: Part[] = [{ id: 'x', poly: square(100, 200, 40) }, { id: 'k', poly: rectPoly(200, 210, 260, 230) }];
    const B: Part[] = [{ id: 'x', poly: square(420, 200, 40) }, { id: 'y', poly: square(600, 320, 40) }, { id: 'k', poly: rectPoly(500, 210, 560, 230) }];
    const store = evidence();
    const [paired] = filmsAt(shows(), store, pair(store, 'pairs', A, B, { transitions: { mm: matchMorph('fa', 'fb', { pairs: { '#x': '#y' } }) } }), [fl(1)], 'the morph with pairs');
    const [plain] = filmsAt(shows(), store, pair(store, 'no-pairs', A, B, { transitions: { mm: matchMorph('fa', 'fb') } }), [fl(1)], 'the morph without pairs');
    const x = onePiece(piecesOf(paired!, 'mm', 'with pairs at 1 s'), (q) => q.from === 'fa#x', 'from fa#x', 'with pairs at 1 s');
    expect(x.to, 'with pairs, fa#x goes to fb#y').toBe('fb#y');
    expect(dist(x.center, centreOf(B, 'y')), `with pairs, x ends at ${fmt(x.center)}, y's place ${fmt(centreOf(B, 'y'))} within 0.5 u`).toBeLessThanOrEqual(0.5);
    const control = onePiece(piecesOf(plain!, 'mm', 'without pairs at 1 s'), (q) => q.from === 'fa#x', 'from fa#x', 'without pairs at 1 s');
    expect(dist(control.center, centreOf(B, 'x')), `the fixture discriminates: without pairs x ends at B's x ${fmt(centreOf(B, 'x'))}, got ${fmt(control.center)}`).toBeLessThanOrEqual(0.5);
  }, TIMEOUT);

  it(`${AC[4]} with unpaired: cross_fade the unpaired outgoing part's opacity and the unpaired incoming part's sum to 1 ± 0.01 at every frame`, () => {
    const A: Part[] = [{ id: 'k', poly: rectPoly(100, 210, 160, 230) }, { id: 'old', poly: rectPoly(200, 180, 280, 200) }];
    const B: Part[] = [{ id: 'k', poly: rectPoly(400, 210, 460, 230) }, { id: 'new', poly: rectPoly(520, 150, 550, 260) }];
    const store = evidence();
    const times = frames60(0, 1);
    const films = filmsAt(shows(), store, pair(store, 'cross-fade', A, B, { transitions: { mm: matchMorph('fa', 'fb', { unpaired: 'cross_fade' }) } }), times, 'the cross-fade morph');
    const failures: string[] = []; const outs: number[] = [];
    films.forEach((f, i) => {
      const what = `at ${times[i]} flicks`;
      const pieces = piecesOf(f, 'mm', what);
      const out = onePiece(pieces, (q) => q.from === 'fa#old' && q.to === null, 'fa#old going out', what).opacity;
      const inn = onePiece(pieces, (q) => q.from === null && q.to === 'fb#new', 'fb#new coming in', what).opacity;
      outs.push(out);
      if (Math.abs(out + inn - 1) > 0.01) failures.push(`${what} the opacities ${out} + ${inn} = ${out + inn}, not 1 ± 0.01`);
    });
    none(failures, 'the cross-fade sums to 1 at every frame');
    expect(Math.abs(outs[0]! - 1) <= 0.01 && Math.abs(outs[outs.length - 1]!) <= 0.01, `the outgoing part goes from 1 to 0 (${outs[0]} → ${outs[outs.length - 1]}), so a constant half each fails`).toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} with unpaired: split one square ends as three faded copies on the three squares the other side leaves unpaired`, () => {
    const A: Part[] = [{ id: 'k', poly: rectPoly(100, 300, 160, 320) }, { id: 'sq', poly: square(120, 120, 60) }];
    const B: Part[] = [{ id: 'k', poly: rectPoly(400, 300, 460, 320) }, { id: 's1', poly: square(420, 100, 20) }, { id: 's2', poly: square(500, 140, 20) }, { id: 's3', poly: square(580, 180, 20) }];
    const store = evidence();
    const [mid, end] = filmsAt(shows(), store, pair(store, 'split', A, B, { transitions: { mm: matchMorph('fa', 'fb', { unpaired: 'split' }) } }), [fl(0.5), fl(1)], 'the split morph');
    const copies = piecesOf(end!, 'mm', 'at 1 s').filter((q) => q.from === 'fa#sq');
    expect(copies.map((q) => q.to).sort(), 'at the end the square has become three copies, one on each unpaired square').toEqual(['fb#s1', 'fb#s2', 'fb#s3']);
    const failures: string[] = [];
    for (const c of copies) {
      const want = centreOf(B, c.to!.slice(3));
      if (dist(c.center, want) > 0.5) failures.push(`the copy to ${c.to} ends at ${fmt(c.center)}, not on its square ${fmt(want)} within 0.5 u`);
    }
    const halfway = piecesOf(mid!, 'mm', 'at 0.5 s').filter((q) => q.from === 'fa#sq');
    if (halfway.length !== 3) failures.push(`halfway there are ${halfway.length} copies of the square, not three`);
    for (const c of halfway) if (!(c.opacity > 0 && c.opacity < 1)) failures.push(`halfway the copy to ${c.to} is at opacity ${c.opacity}, not faded`);
    none(failures, 'the split');
  }, TIMEOUT);
});

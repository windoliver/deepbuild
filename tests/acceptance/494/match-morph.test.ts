// AC2 #494.67b2ec28: A 1 s match morph between two formula imports whose shared parts carry the same ids moves each
// shared part's centre from its old to its new place along the progress within 0.5 u at 0, 0.5 and 1 s, fades the parts
// only one side has, and between two states of one graph pairs each node by key.
//
// Through `deep-show run` (`full`): a film with two vector@1 formulas over SVGs this suite writes (README: Formulas),
// `fa` ("x + y", with a part only it has) and `fb` ("y + x", the shared parts at new places, with a part only it has),
// and a match_morph transition `mm` from fa to fb, its 1 s window [0 s, 1 s] (`at: 0.5s`, linear progress), read by
// `eval` with `film: true` at 0, 0.5 and 1 s from the film block's `morphs.mm` (README: `morphs`). The shared parts
// differ in shape and are listed in another order on each side, so pairing by reading order or by shape moves x to y's
// place and fails. The graph half morphs `g1` (the chain a → b → c, listed a, b, c) into `g2` (c → b → a, listed c, b,
// a): by key a goes from the top rank to the bottom and c the other way, where pairing by row or shape keeps each rank.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, boxCenter, dist, film, filmsAt, fl, fmt, formula, graph, lerp2, matchMorph, none, onePiece, piecesOf, putStore, rectPoly, svgOf,
  useEvidence, useShow, type Part, type Piece, type V2,
} from './helpers.ts';

const shows = useShow();
const evidence = useEvidence();
const TIMES = [0, fl(0.5), fl(1)];

// "x + y" becomes "y + x": x, plus and y are shared (each its own shape), old is only in A, new only in B.
const A: Part[] = [
  { id: 'x', poly: rectPoly(100, 200, 140, 240) },
  { id: 'plus', poly: rectPoly(160, 215, 180, 225) },
  { id: 'y', poly: rectPoly(200, 190, 230, 250) },
  { id: 'old', poly: rectPoly(260, 210, 340, 230) },
];
const B: Part[] = [
  { id: 'y', poly: rectPoly(420, 190, 450, 250) },
  { id: 'plus', poly: rectPoly(470, 215, 490, 225) },
  { id: 'x', poly: rectPoly(510, 200, 550, 240) },
  { id: 'new', poly: rectPoly(600, 180, 630, 260) },
];
const centreOf = (side: Part[], id: string): V2 => boxCenter(side.find((p) => p.id === id)!.poly);

describe(`${AC[2]} a match morph pairs formula parts by id and graph nodes by key`, () => {
  it(`${AC[2]} between two formula imports each shared part's centre moves from its old to its new place along the progress within 0.5 u at 0, 0.5 and 1 s, and the parts only one side has fade`, () => {
    const store = evidence();
    const doc = film('formulas', [formula('fa', putStore(store, svgOf(A)), 'x + y'), formula('fb', putStore(store, svgOf(B)), 'y + x')], { transitions: { mm: matchMorph('fa', 'fb') } });
    const films = filmsAt(shows(), store, doc, TIMES, 'the formula morph');
    const failures: string[] = [];
    films.forEach((f, i) => {
      const p = i / 2; const what = `at ${p} s`;
      const pieces = piecesOf(f, 'mm', what);
      for (const id of ['x', 'plus', 'y']) {
        const piece = onePiece(pieces, (q) => q.from === `fa#${id}` && q.to === `fb#${id}`, `fa#${id} → fb#${id}`, what);
        const want = lerp2(centreOf(A, id), centreOf(B, id), p);
        if (dist(piece.center, want) > 0.5) failures.push(`${what} ${id}'s centre is ${fmt(piece.center)}, not ${fmt(want)} within 0.5 u`);
      }
      const old = onePiece(pieces, (q) => q.from === 'fa#old' && q.to === null, 'fa#old fading out', what);
      const neu = onePiece(pieces, (q) => q.from === null && q.to === 'fb#new', 'fb#new fading in', what);
      const fading = (q: Piece, name: string, want: V2, opacity: number): void => {
        if (dist(q.center, want) > 0.5) failures.push(`${what} ${name} fades at ${fmt(q.center)}, not in its place ${fmt(want)}`);
        if (p === 0.5 ? !(q.opacity > 0.01 && q.opacity < 0.99) : Math.abs(q.opacity - opacity) > 0.01) failures.push(`${what} ${name}'s opacity is ${q.opacity}, not ${p === 0.5 ? 'between 0 and 1' : opacity}`);
      };
      fading(old, 'old', centreOf(A, 'old'), 1 - p);
      fading(neu, 'new', centreOf(B, 'new'), p);
    });
    none(failures, 'the formula morph');
  }, TIMEOUT);

  it(`${AC[2]} between two states of one graph the morph pairs each node by key`, () => {
    const g1 = graph('g1', ['a', 'b', 'c'], [['e1', 'a', 'b'], ['e2', 'b', 'c']], [200, 60]);
    const g2 = graph('g2', ['c', 'b', 'a'], [['e1', 'c', 'b'], ['e2', 'b', 'a']], [200, 60]);
    const doc = film('graph-states', [g1, g2], { transitions: { gm: matchMorph('g1', 'g2') } });
    const [start, , end] = filmsAt(shows(), evidence(), doc, TIMES, 'the graph morph');
    const node = (f: (typeof start), k: string, what: string): Piece => onePiece(piecesOf(f!, 'gm', what), (q) => q.from === `g1#${k}` || q.to === `g2#${k}`, `the node ${k}`, what);
    const failures: string[] = [];
    const at0 = Object.fromEntries(['a', 'b', 'c'].map((k) => [k, node(start, k, 'at 0 s')]));
    const at1 = Object.fromEntries(['a', 'b', 'c'].map((k) => [k, node(end, k, 'at 1 s')]));
    for (const k of ['a', 'b', 'c']) {
      for (const [q, when] of [[at0[k]!, '0 s'], [at1[k]!, '1 s']] as [Piece, string][]) {
        if (q.from !== `g1#${k}` || q.to !== `g2#${k}`) failures.push(`at ${when} the node ${k}'s piece goes ${q.from} → ${q.to}, not g1#${k} → g2#${k}`);
      }
    }
    expect(dist(at0['a']!.center, at0['c']!.center), 'the fixture discriminates: a and c start on different ranks').toBeGreaterThan(10);
    // By key, a lands on the rank c started on, c on a's, and b stays.
    for (const [k, on] of [['a', 'c'], ['c', 'a'], ['b', 'b']] as [string, string][]) {
      if (dist(at1[k]!.center, at0[on]!.center) > 0.5) failures.push(`the node ${k} ends at ${fmt(at1[k]!.center)}, not where ${on} started, ${fmt(at0[on]!.center)}`);
    }
    none(failures, 'the graph morph pairs by key');
  }, TIMEOUT);
});

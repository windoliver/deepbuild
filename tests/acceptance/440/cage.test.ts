// AC5: "A slab box subdivided twice by Catmull-Clark draws 12 edge segments as `cage`, 192 as `quads` and 288 as
// `all`, with V − E + F = 98 − 192 + 96 = 2; a planted `quads` that keeps each quad's diagonal draws 288 and fails,
// and a planted `cage` that reads the subdivided mesh draws 192 and fails"
//
// The parity fixture (parity/geometry/subdivide-cage.scene): a 1 m slab box with `mod.subdivide@1 {levels: 2}`
// and three mark.line@1 items reading its edges. `geometry` answers each line with the segments it draws. On
// welded positions, each segment once: cage is the box's 12 edges between its 8 corners; quads is the 192 edges
// of the subdivided mesh's 96 faces (reference.ts: meshEdges on the cube's own row, a face's diagonal left out);
// all is every triangle edge, 288, quads among them. The cube's welded points, edges and faces give
// V − E + F = 98 − 192 + 96 = 2. Each twin must fail, naming the count it draws.

import { describe, it } from 'vitest';
import { AC, DOC, SLOW, admitted, facesOf, failsNaming, fixture, geometryCall, meshRow, none, num, obj, runShow, scenario, sceneDoc, segmentsOf, show, useDir, useShow, type JsonObject, type ShowPlanted } from './helpers.ts';
import { dist, meshEdges, segmentKey, weld, weldKey, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const SCENE = fixture('parity', 'geometry', 'subdivide-cage.scene');
const ITEMS = obj(SCENE['items'], 'the fixture\'s items') as Record<string, JsonObject>;
const WANT = obj(SCENE['expected'], 'the fixture\'s expected counts');
const TWINS = SCENE['twins'] as JsonObject[];
const want = (k: string): number => num(WANT[k], `expected.${k}`);

/** The slab box's 8 corners and 12 edges, as segment keys. */
const BOX_EDGES = (() => {
  const corners: V3[] = [];
  for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) corners.push([x, y, z]);
  const keys = new Set<string>();
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if (Math.abs(dist(corners[i]!, corners[j]!) - 1) < 1e-9) keys.add(segmentKey(corners[i]!, corners[j]!));
  return keys;
})();

/** Every check AC5 names; a count failure starts `<kind> draws <n> segments`. */
function cageProblems(planted?: ShowPlanted): string[] {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [
    show(DOC.a, sceneDoc('A subdivided box and its cage', ITEMS)), geometryCall(DOC.a, Object.keys(ITEMS)),
  ], planted));
  admitted(shown!, 'the cage fixture');
  const out: string[] = [];
  const g = meshRow(reply!, 'cube', 'the cube');
  const faces = facesOf(g, 'the cube');
  const edges = meshEdges(g.positions, g.indices, faces);
  const [V, E, F] = [weld(g.positions).points.length, edges.quads.size, new Set(faces).size];
  if (V !== want('V') || E !== want('E') || F !== want('F')) out.push(`the subdivided box has V − E + F = ${V} − ${E} + ${F} = ${V - E + F}, not ${want('V')} − ${want('E')} + ${want('F')} = 2`);
  const drawn = (kind: string): Set<string> => {
    const segs = segmentsOf(reply!, `edges_${kind}`, `the ${kind} line`);
    const keys = new Set(segs.filter(([a, b]) => weldKey(a) !== weldKey(b)).map(([a, b]) => segmentKey(a, b)));
    if (segs.length !== want(kind)) out.push(`${kind} draws ${segs.length} segments, not ${want(kind)}`);
    if (keys.size !== segs.length) out.push(`${kind} draws ${segs.length - keys.size} segments twice or of no length, on welded positions`);
    return keys;
  };
  const cage = drawn('cage'); const quads = drawn('quads'); const all = drawn('all');
  const outside = (a: Set<string>, b: Set<string>): number => [...a].filter((k) => !b.has(k)).length;
  if (outside(cage, BOX_EDGES) || outside(BOX_EDGES, cage)) out.push(`cage isn't the box's 12 edges before the subdivide: ${outside(cage, BOX_EDGES)} segments drawn off them, ${outside(BOX_EDGES, cage)} of them left out`);
  if (outside(quads, edges.quads) || outside(edges.quads, quads)) out.push(`quads isn't the subdivided mesh's face edges: ${outside(quads, edges.quads)} extra, ${outside(edges.quads, quads)} missing`);
  if (outside(all, edges.all) || outside(edges.all, all)) out.push(`all isn't every triangle edge of the subdivided mesh: ${outside(all, edges.all)} extra, ${outside(edges.all, all)} missing`);
  if (outside(quads, all)) out.push(`quads draws ${outside(quads, all)} segments all doesn't`);
  return out;
}

describe(`${AC[5]} cage, quads and all on a slab box subdivided twice`, () => {
  it(`${AC[5]} cage draws 12, quads 192 and all 288, with V − E + F = 98 − 192 + 96 = 2`, () => {
    none(cageProblems(), 'the subdivided box\'s edges');
  }, SLOW);

  for (const twin of TWINS) {
    it(`${AC[5]} the planted ${String(twin['planted'])} (${String(twin['wrong'])}) fails, naming what it draws`, () => {
      failsNaming(cageProblems(twin['planted'] as ShowPlanted), twin['names'] as string[], `the planted ${String(twin['planted'])}`);
    }, SLOW);
  }
});

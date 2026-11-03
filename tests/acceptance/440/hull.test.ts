// AC6: "A hull of a 1 m cube's 8 corners, 100 seeded points inside it and 12 on its faces builds a closed mesh of
// 8 corners and 12 triangles, V − E + F = 2 on welded positions, with an area of 6 m² and a volume of 1 m³ within
// 1e-12 relative, and the same points shuffled give the same mesh hash; a planted builder that keeps the face
// points as vertices builds more than 8 and fails, naming the item, and one that fans each face from its first
// point in input order gives another hash when shuffled and fails. A hull `of` a geodesic ball at detail 0 and
// radius 1 m has the icosahedron's 12 vertices, 20 faces and volume 2.53615 m³ within 1e-5, and four points on
// one plane are refused with hull.flat, naming the item"
//
// The parity fixture (parity/geometry/hull-cube.scene) holds the 120 points, the shuffle seeds, the expected
// values and the twins. One document holds `crystal` (the points as listed) and `crystal_s1`, `crystal_s2` (the
// same points shuffled, reference.ts: shuffled). Each must be watertight on welded positions with exactly the
// cube's 8 corners and 12 triangles, V − E + F = 2, area 6 m² and volume 1 m³ within 1e-12 relative, and all three
// must give one mesh hash (reference.ts: meshHash, over positions and indices in order). Every failure starts
// with the item's ID, so it names the item. The icosahedron and the flat set are two more documents.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, errors, failsNaming, fixture, geometryCall, issues, meshRow, none, num, obj, runShow, scenario, sceneDoc, show, shown, useDir, useShow, type JsonObject, type MeshRow, type ShowPlanted } from './helpers.ts';
import { areaOf, fanOrderShows, fmt, fmtV, meshHash, shuffled, topology, volumeOf, weld, weldKey, weldedTriangles, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const SCENE = fixture('parity', 'geometry', 'hull-cube.scene');
const CORNERS = SCENE['corners'] as V3[];
const POINTS: V3[] = [...CORNERS, ...(SCENE['inside'] as V3[]), ...(SCENE['on_faces'] as V3[])];
const SEEDS = SCENE['shuffle_seeds'] as number[];
const WANT = obj(SCENE['expected'], 'expected');
const ICOSA = obj(SCENE['icosahedron'], 'icosahedron');
const FLAT = obj(SCENE['flat'], 'flat');
const TWINS = SCENE['twins'] as JsonObject[];
const REL = num(WANT['rel'], 'expected.rel');

const HULLS: Record<string, V3[]> = { crystal: POINTS, ...Object.fromEntries(SEEDS.map((s) => [`crystal_s${s}`, shuffled(POINTS, s)])) };
const hullItem = (points: V3[]): JsonObject => ({ kind: 'hull@1', params: { points } });

/** The closed-mesh checks AC6 names on one hull, each failure starting with its item's ID. */
function closedProblems(g: MeshRow, corners: number, triangles: number): string[] {
  const out: string[] = [];
  const w = weld(g.positions);
  const tris = weldedTriangles(g.indices, w.ids);
  const t = topology(tris);
  if (w.points.length !== corners) out.push(`${g.id}: ${w.points.length} welded corners, not ${corners}`);
  if (g.indices.length / 3 !== triangles) out.push(`${g.id}: ${g.indices.length / 3} triangles, not ${triangles}`);
  if (t.open || t.nonManifold || t.misoriented) out.push(`${g.id}: not closed: ${t.open} open edges, ${t.nonManifold} on more than two triangles, ${t.misoriented} wound the same way twice`);
  if (t.V - t.E + t.F !== 2) out.push(`${g.id}: V − E + F = ${t.V} − ${t.E} + ${t.F} = ${t.V - t.E + t.F}, not 2`);
  return out;
}

function cubeProblems(planted?: ShowPlanted): string[] {
  const doc = sceneDoc('Hulls of a cube\'s points', Object.fromEntries(Object.entries(HULLS).map(([id, p]) => [id, hullItem(p)])));
  const [sh, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), geometryCall(DOC.a, Object.keys(HULLS))], planted));
  admitted(sh!, 'the cube hulls');
  const out: string[] = [];
  const cornerKeys = new Set(CORNERS.map(weldKey));
  const hashes = new Map<string, string>();
  for (const id of Object.keys(HULLS)) {
    const g = meshRow(reply!, id, 'the hulls\' geometry');
    out.push(...closedProblems(g, num(WANT['corners'], 'corners'), num(WANT['triangles'], 'triangles')));
    const extra = g.positions.filter((p) => !cornerKeys.has(weldKey(p)));
    if (extra.length) out.push(`${id}: keeps ${extra.length} vertices that aren't the cube's corners, such as ${fmtV(extra[0]!)}`);
    const w = weld(g.positions);
    const tris = weldedTriangles(g.indices, w.ids);
    const area = areaOf(w.points, tris); const volume = volumeOf(w.points, tris);
    const [A, Vol] = [num(WANT['area'], 'area'), num(WANT['volume'], 'volume')];
    if (!(Math.abs(area - A) <= REL * A)) out.push(`${id}: area ${fmt(area)} m², not ${A} m² within ${REL} relative (off by ${fmt(Math.abs(area - A) / A)})`);
    if (!(Math.abs(volume - Vol) <= REL * Vol)) out.push(`${id}: volume ${fmt(volume)} m³, not ${Vol} m³ within ${REL} relative (off by ${fmt(Math.abs(volume - Vol) / Vol)})`);
    hashes.set(id, meshHash(g.positions, g.indices));
  }
  for (const [id, h] of hashes) if (h !== hashes.get('crystal')) out.push(`${id}: its mesh hash ${h.slice(0, 16)} differs from crystal's ${hashes.get('crystal')!.slice(0, 16)}: the hull depends on its points' order`);
  return out;
}

describe(`${AC[6]} convex hulls`, () => {
  it(`${AC[6]} the cube's corners with points inside and on its faces build 8 corners and 12 triangles, closed, 6 m² and 1 m³ within 1e-12, one hash in any order`, () => {
    none(cubeProblems(), 'the cube hulls');
  }, SLOW);

  for (const twin of TWINS) {
    it(`${AC[6]} the planted ${String(twin['planted'])} (${String(twin['wrong'])}) fails, naming the item`, () => {
      if (twin['planted'] === 'hull_fan_input_order') {
        // The shuffles must move some face's first corner off the diagonal the corner that sorts first gives.
        expect(SEEDS.some((s) => fanOrderShows(HULLS[`crystal_s${s}`]!.filter((p) => p.every((x) => x === 0 || x === 1)))), 'a shuffle changes some face\'s fan').toBe(true);
      }
      failsNaming(cubeProblems(twin['planted'] as ShowPlanted), twin['names'] as string[], `the planted ${String(twin['planted'])}`);
    }, SLOW);
  }

  it(`${AC[6]} a hull of a geodesic icosa ball at detail 0 and radius 1 m has 12 vertices, 20 faces and 2.53615 m³ within 1e-5`, () => {
    const doc = sceneDoc('A hull of an icosahedron', { ball: obj(ICOSA['ball'], 'icosahedron.ball'), gem: { kind: 'hull@1', params: { of: 'ball' } } });
    const [sh, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), geometryCall(DOC.a, ['gem'])]));
    admitted(sh!, 'the icosahedron hull');
    const g = meshRow(reply!, 'gem', 'the gem');
    const problems = closedProblems(g, num(ICOSA['vertices'], 'vertices'), num(ICOSA['triangles'], 'triangles'));
    const w = weld(g.positions);
    const off = w.points.filter((p) => Math.abs(Math.hypot(...p) - 1) > 1e-9);
    if (off.length) problems.push(`gem: ${off.length} corners are off the ball's unit sphere, such as ${fmtV(off[0]!)}`);
    const volume = volumeOf(w.points, weldedTriangles(g.indices, w.ids));
    const want = num(ICOSA['volume'], 'volume');
    if (!(Math.abs(volume - want) <= num(ICOSA['volume_abs'], 'volume_abs'))) problems.push(`gem: volume ${fmt(volume)} m³, not ${want} m³ within ${String(ICOSA['volume_abs'])}`);
    none(problems, 'the icosahedron hull');
  }, SLOW);

  it(`${AC[6]} four points on one plane are refused with hull.flat, naming the item`, () => {
    const doc = sceneDoc('A flat hull', { slate: hullItem(FLAT['points'] as V3[]) });
    const [reply] = runShow(bin(), scenario(dir(), [DOC.b], [show(DOC.b, doc)]));
    const flat = errors(issues(reply!, 'the flat hull')).filter((i) => i.code === 'hull.flat');
    expect(flat.map((i) => i.raw), `the flat hull: an error issue hull.flat: ${shown(reply)}`).not.toEqual([]);
    expect(flat.some((i) => i.path === 'items/slate' || i.path.startsWith('items/slate/')), `hull.flat names the item slate (its path is under items/slate): ${shown(flat.map((i) => i.raw))}`).toBe(true);
    expect(reply!['outcome'], `the flat hull is refused: ${shown(reply)}`).toBe('refused');
  }, SLOW);
});

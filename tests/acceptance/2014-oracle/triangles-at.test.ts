// The cell split of the pinned upstream physics library's height field, `triangles_at` in src/shape/heightfield3.rs
// (lines 338 to 410) at commit 3383f51cbbe9af70565427e7a66c605e1557c1fc, run against our output (#136: a linked test
// counts only when run against our output). The oracle page's use is "formula": the physics height field splits each
// cell along one diagonal unless the cell is flagged to zigzag, and the plate's drawn triangles must split the same way.
// No upstream code runs here and none is copied: which corners form each of a cell's two triangles is written out below
// in upstream's own indexing, named after its function.
//
// Upstream, and ours:
//   - Upstream's heights are rows i along z and columns j along x; cell (i, j) spans x from x_at(j) to x_at(j + 1) and
//     z from z_at(i) to z_at(i + 1), with x_at(j) = (−0.5 + j ÷ columns) × scale.x, so the samples lie centred on the
//     shape's origin, as our plate's do (README: The surface under test). Its corners are p00 (x0, z0), p10 (x0, z1),
//     p01 (x1, z0) and p11 (x1, z1), each at its sample's height.
//   - A cell not flagged to zigzag is the triangles (p00, p10, p01) and (p10, p11, p01), split along p10–p01; one
//     flagged is (p00, p10, p11) and (p00, p11, p01), split along p00–p11. Removed triangles aren't used here.
//   - Ours: a 4 × 4 m terrain plate at 1 m spacing whose field (x × z + x) ÷ 8 twists every cell by 0.125 m, so the two
//     splits differ everywhere off a cell's diagonals. Every cell's drawn triangles (the geometry row) must be exactly
//     one of the formula's two pairs, at the field's heights; and where rays straight down at four points off both
//     diagonals of each cell meet the physics height-field shape (terrain_rays' `physics`), they must lie on the
//     formula's surface for that same pair within 1e-6 m. Every height and point here is a multiple of 1/32 m, exact in
//     f32.
import { describe, expect, it } from 'vitest';
import {
  AC, PLATE, TIMEOUT, TOL, docId, down, drawnOf, geometry, gridTris, none, plateDoc, presented, raysOf, run, scenarioOf, show,
  terrainRays, topAt, useFolders, useShow,
  type Cell, type Hits, type Terrain, type Tri, type V3,
} from './helpers.ts';

const ID = AC[1];
const bin = useShow();
const folder = useFolders();
const DOC = docId(14);

const FIELD: Terrain = { height: '(position.x * position.z + position.x) * 0.125', size: [4, 4], spacing: 1, tile: 4, lod_levels: 1 };
const fieldHeight = (x: number, z: number): number => (x * z + x) * 0.125;
const COLUMNS = 4, ROWS = 4;
/** Four points of a cell, as fractions of its side along x and z, off both its diagonals. */
const OFF_DIAGONALS: readonly [number, number][] = [[0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
const TOP = 2;

type Split = 'default' | 'zigzag';
/** Upstream's triangles_at(i, j): cell (row i along z, column j along x) as its two triangles, by its status. */
function trianglesAt(t: Terrain, h: (x: number, z: number) => number, i: number, j: number, split: Split): [Tri, Tri] {
  const x0 = -t.size[0] / 2 + j * t.spacing, x1 = x0 + t.spacing;
  const z0 = -t.size[1] / 2 + i * t.spacing, z1 = z0 + t.spacing;
  const p = (x: number, z: number): V3 => [x, h(x, z), z];
  const [p00, p10, p01, p11] = [p(x0, z0), p(x0, z1), p(x1, z0), p(x1, z1)];
  return split === 'zigzag' ? [[p00, p10, p11], [p00, p11, p01]] : [[p00, p10, p01], [p10, p11, p01]];
}

const near = (a: V3, b: V3): boolean => Math.abs(a[0] - b[0]) <= TOL && Math.abs(a[1] - b[1]) <= TOL && Math.abs(a[2] - b[2]) <= TOL;
const sameTri = (a: Tri, b: Tri): boolean => a.every((p) => b.some((q) => near(p, q))) && b.every((q) => a.some((p) => near(p, q)));
/** Our cell [c, r] is upstream's (row i = r, column j = c). */
const named = (c: number, r: number): string => `cell [${c}, ${r}] (upstream row ${r}, column ${c})`;

/** The drawn triangles over each cell, by their centroids, and which of the formula's pairs they are; failures name the cell. */
function drawnSplits(drawn: readonly Tri[]): { splits: Map<string, Split>; failures: string[] } {
  const splits = new Map<string, Split>(), failures: string[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLUMNS; c++) {
    const x0 = -FIELD.size[0] / 2 + c, z0 = -FIELD.size[1] / 2 + r;
    const over = drawn.filter((t) => {
      const [x, z] = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];
      return x > x0 && x < x0 + 1 && z > z0 && z < z0 + 1;
    });
    const split = (['default', 'zigzag'] as const).find((s) => {
      const pair = trianglesAt(FIELD, fieldHeight, r, c, s);
      return over.length === 2 && pair.every((f) => over.some((d) => sameTri(d, f)));
    });
    if (split) splits.set(`${c},${r}`, split);
    else failures.push(`${named(c, r)}: its ${over.length} drawn triangles are neither of the formula's pairs: ${JSON.stringify(over)}`);
  }
  return { splits, failures };
}

/** The rays down at each cell's four off-diagonal points, cell by cell. */
const RAYS = Array.from({ length: ROWS * COLUMNS }, (_, k) => [k % COLUMNS, Math.floor(k / COLUMNS)] as Cell)
  .flatMap(([c, r]) => OFF_DIAGONALS.map(([u, v]) => down(-FIELD.size[0] / 2 + c + u, -FIELD.size[1] / 2 + r + v, TOP)));

/** Why the physics hits don't lie on the formula's surface for each cell's drawn pair; each failure names its cell. */
function physicsFailures(splits: Map<string, Split>, hits: readonly Hits[]): string[] {
  const failures: string[] = [];
  hits.forEach((hit, k) => {
    const cell = Math.floor(k / OFF_DIAGONALS.length);
    const [c, r] = [cell % COLUMNS, Math.floor(cell / COLUMNS)];
    const split = splits.get(`${c},${r}`);
    if (!split) return;
    const [x, , z] = RAYS[k]!.from;
    const y = topAt(trianglesAt(FIELD, fieldHeight, r, c, split), x, z)!;
    const p = hit.physics;
    if (p === null) failures.push(`${named(c, r)}: the ray down through (${x}, ${z}) meets no physics shape`);
    else if (!near(p, [x, y, z])) failures.push(`${named(c, r)}: the physics shape is met at (${p.join(', ')}), not on the formula's ${split} split at (${x}, ${y}, ${z})`);
  });
  return failures;
}

/**
 * The judges fail their planted sets: the formula's default split drawn and met passes; drawn default and met zigzag
 * fails at all 16 cells; a cell drawn as four triangles round its centre fails as neither pair; and the #2014 suite's
 * planted sets read as the formula's splits, `anti` as default and `main` (the base's plate@1 grid) as zigzag.
 */
function judgesFailTheirPlants(): void {
  const all = (s: Split): Tri[] => Array.from({ length: ROWS * COLUMNS }, (_, k) => trianglesAt(FIELD, fieldHeight, Math.floor(k / COLUMNS), k % COLUMNS, s)).flat();
  const met = (s: Split): Hits[] => RAYS.map(({ from: [x, , z] }) => { const y = topAt(all(s), x, z); return { drawn: null, physics: y === null ? null : [x, y, z], pick: null }; });
  const ok = drawnSplits(all('default'));
  expect(ok.failures, 'the formula\'s default split reads as one of its pairs at every cell').toEqual([]);
  expect(physicsFailures(ok.splits, met('default')), 'met where it is drawn, it passes').toEqual([]);
  expect(physicsFailures(ok.splits, met('zigzag')).length, 'drawn default and met zigzag, it fails at four points of each of the 16 cells').toBe(64);
  const [x0, z0] = [-FIELD.size[0] / 2, -FIELD.size[1] / 2];
  const m: V3 = [x0 + 0.5, fieldHeight(x0 + 0.5, z0 + 0.5), z0 + 0.5];
  const [a, b, d, e]: [V3, V3, V3, V3] = [[x0, fieldHeight(x0, z0), z0], [x0 + 1, fieldHeight(x0 + 1, z0), z0], [x0, fieldHeight(x0, z0 + 1), z0 + 1], [x0 + 1, fieldHeight(x0 + 1, z0 + 1), z0 + 1]];
  const fan: Tri[] = [[a, b, m], [b, e, m], [e, d, m], [d, a, m]];
  expect(drawnSplits([...fan, ...all('default').slice(2)]).failures.length, 'a cell drawn as four triangles round its centre is neither pair').toBe(1);
  expect([...drawnSplits(gridTris(FIELD, fieldHeight, 'anti')).splits.values()], 'the suite\'s anti split is upstream\'s default').toEqual(Array(16).fill('default'));
  expect([...drawnSplits(gridTris(FIELD, fieldHeight, 'main')).splits.values()], 'the suite\'s main split is upstream\'s zigzag').toEqual(Array(16).fill('zigzag'));
}

describe(`${ID} oracle: the pinned height field's cell split, drawn and met the same way`, () => {
  it(`${ID} every cell's drawn triangles are one of the formula's two pairs, and the physics height-field shape lies on that pair`, () => {
    judgesFailTheirPlants();
    const calls = [show(DOC, plateDoc(FIELD, 'A twisted 4 × 4 m plate')), geometry(DOC, [PLATE]), terrainRays(DOC, PLATE, RAYS)];
    const [shown, built, met] = run(bin(), scenarioOf(folder(), [DOC], calls));
    presented(shown!, 'the twisted plate');
    const { splits, failures } = drawnSplits(drawnOf(built!, PLATE, 'the twisted plate').tris);
    none(failures, 'each cell is drawn as one of the formula\'s two pairs of triangles, at the field\'s heights');
    none(physicsFailures(splits, raysOf(met!, RAYS.length, 'the rays off each cell\'s diagonals').rays), 'the physics height-field shape splits each cell as it is drawn, within 1e-6 m');
  }, TIMEOUT);
});

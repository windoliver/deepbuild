// AC1: "A flat plane of 2 × 2 quads (8 triangles) whose two columns are named parts with different materials, under
// `crease {angle: 30}`, `border: false` and `material: true`, draws exactly 2 segments, end to end along the line
// between the columns, and no diagonal. With `border: true` it draws 10, with one material 0, and with a material
// per quad 4. A planted picker that keeps every edge two faces share draws 8 and fails, naming the item and the count"
//
// The plane is generated (reference.ts: planeParts) and drawn as `mesh.asset@1`: 1 × 1 m in y = 0, each part a glTF
// primitive with its own vertices, which the base imports as the named parts `primitive.0`, `primitive.1`, …. Three
// items read it: `plane` (two columns, `materials` giving each column its own material), `plane_one` (the same two
// columns, both mapped to one material) and `plane_quads` (four primitives, a material each). All run on the noop
// lane with `counts: true` and are read from `segments`, in world metres.
//
// Fixture guards, which the base answers, drawn from a document without `material`: each item's `all` line draws the
// plane's 16 welded edges and its crease line with `border: true` draws its 8 border edges, with the `materials`
// maps admitted. Conditions: with `material: true` and `border: false`, `plane` draws exactly the two halves of the
// line x = 0 from z = −0.5 to 0.5 m; with `border: true` those and the 8 border edges; `plane_one` draws nothing;
// `plane_quads` draws the two halves of x = 0 and the two halves of z = 0. No line draws a diagonal or a segment
// twice. Under `--planted edges_material_every_shared`, `plane` draws 8 and the check fails, naming `plane` and 8.

import { describe, expect, it } from 'vitest';
import { segKey } from '../1640/helpers.ts';
import type { V3 } from '../1640/reference.ts';
import {
  AC, NOOP, assetItem, creaseEdges, failsNaming, framesOf, line, material, none, perspective, run, segmentsOf, startName, useDir, useGpuBin,
  viewCall, type Draw, type Frame, type JsonObject, type Startup,
} from './helpers.ts';
import { PLANE, PLANE_COUNTS, gltfParts, planeParts } from './reference.ts';

const bin = useGpuBin();
const dir = useDir();

const COLUMNS = gltfParts(planeParts('columns'));
const QUADS = gltfParts(planeParts('quads'));
/** The three items, 2 m apart along x: what each reads, where it stands and its part-to-material map. */
const PLANES = {
  plane: { asset: COLUMNS, at: [0, 0, 0] as V3, materials: { 'primitive.0': 'm0', 'primitive.1': 'm1' } },
  plane_one: { asset: COLUMNS, at: [2, 0, 0] as V3, materials: { 'primitive.0': 'm0', 'primitive.1': 'm0' } },
  plane_quads: { asset: QUADS, at: [4, 0, 0] as V3, materials: { 'primitive.0': 'm0', 'primitive.1': 'm1', 'primitive.2': 'm2', 'primitive.3': 'm3' } },
} as const;
type Plane = keyof typeof PLANES;
const NAMES = Object.keys(PLANES) as Plane[];

function scene(title: string, lines: Record<string, JsonObject>): Draw {
  const items: Record<string, JsonObject> = {
    cam: perspective([2, 6, 8], [2, 0, 0]),
    m0: material([0.8, 0.2, 0.2]), m1: material([0.2, 0.3, 0.8]), m2: material([0.2, 0.7, 0.3]), m3: material([0.8, 0.7, 0.2]),
  };
  for (const name of NAMES) items[name] = assetItem(PLANES[name].asset, { at: { pos: [...PLANES[name].at] }, material: 'm0', materials: { ...PLANES[name].materials } });
  return { title, items: { ...items, ...lines }, assets: [COLUMNS, QUADS] };
}
/** The guards' document: no `material` anywhere, so the base draws it. */
const GUARDS = (): Draw => scene('Plane guards', Object.fromEntries(NAMES.flatMap((name) => [
  [`${name}_all`, line({ edges: { of: name, kind: 'all' } })],
  [`${name}_border`, line({ edges: creaseEdges(name, { border: true }) })],
])));
/** The criterion's four lines. */
const MATERIAL = (): Draw => scene('Material edges', {
  columns: line({ edges: creaseEdges('plane', { border: false, material: true }) }),
  columns_border: line({ edges: creaseEdges('plane', { border: true, material: true }) }),
  one: line({ edges: creaseEdges('plane_one', { border: false, material: true }) }),
  quads: line({ edges: creaseEdges('plane_quads', { border: false, material: true }) }),
});

// The reference segment sets, in the plane's own space: the two halves of a line across it.
const HALF = PLANE.size / 2;
/** The two halves of the line x = `x`, running along z. */
const alongZ = (x: number): [V3, V3][] => [[[x, 0, -HALF], [x, 0, 0]], [[x, 0, 0], [x, 0, HALF]]];
/** The two halves of the line z = `z`, running along x. */
const alongX = (z: number): [V3, V3][] => [[[-HALF, 0, z], [0, 0, z]], [[0, 0, z], [HALF, 0, z]]];
const BETWEEN_COLUMNS = alongZ(0);
const BETWEEN_ROWS = alongX(0);
const BORDER = [...alongZ(-HALF), ...alongZ(HALF), ...alongX(-HALF), ...alongX(HALF)];

interface Case { line: string; of: Plane; want: [V3, V3][]; count: number }
const CASES: Case[] = [
  { line: 'columns', of: 'plane', want: BETWEEN_COLUMNS, count: PLANE_COUNTS.columns },
  { line: 'columns_border', of: 'plane', want: [...BETWEEN_COLUMNS, ...BORDER], count: PLANE_COUNTS.withBorder },
  { line: 'one', of: 'plane_one', want: [], count: PLANE_COUNTS.oneMaterial },
  { line: 'quads', of: 'plane_quads', want: [...BETWEEN_COLUMNS, ...BETWEEN_ROWS], count: PLANE_COUNTS.perQuad },
];

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6;
/** One line against its reference set; each failure names the item, and the first names the count. */
function caseProblems(c: Case, drawn: [V3, V3][]): string[] {
  const at = PLANES[c.of].at;
  const segs = drawn.map(([a, b]): [V3, V3] => [[a[0] - at[0], a[1] - at[1], a[2] - at[2]], [b[0] - at[0], b[1] - at[1], b[2] - at[2]]]);
  const out: string[] = [];
  if (segs.length !== c.count) out.push(`material edges of ${c.of} draw ${segs.length} segments, not ${c.count} (line ${c.line})`);
  const got = new Set(segs.map(([a, b]) => segKey(a, b)));
  if (got.size !== segs.length) out.push(`material edges of ${c.of} draw ${segs.length - got.size} segments twice on welded positions (line ${c.line})`);
  const want = new Set(c.want.map(([a, b]) => segKey(a, b)));
  const extra = segs.filter(([a, b]) => !want.has(segKey(a, b)));
  const diagonals = extra.filter(([a, b]) => !near(a[0], b[0]) && !near(a[2], b[2]));
  const missing = c.want.filter(([a, b]) => !got.has(segKey(a, b)));
  if (diagonals.length) out.push(`material edges of ${c.of} draw ${diagonals.length} diagonals, e.g. ${JSON.stringify(diagonals[0])} (line ${c.line})`);
  if (extra.length > diagonals.length) out.push(`material edges of ${c.of} draw ${extra.length - diagonals.length} segments off the lines between its parts${c.line === 'columns_border' ? ' and its border' : ''} (line ${c.line})`);
  if (missing.length) out.push(`material edges of ${c.of} leave out ${missing.length} of ${c.want.length} segments, e.g. ${JSON.stringify(missing[0])}: not end to end (line ${c.line})`);
  return out;
}

/** The guards: every item's `all` line and border line, as the base draws them. */
function guardProblems(f: Frame, what: string): string[] {
  return NAMES.flatMap((name) => {
    const all = segmentsOf(f, `${name}_all`, what).length;
    const border = segmentsOf(f, `${name}_border`, what).length;
    return [
      ...(all === PLANE_COUNTS.all ? [] : [`fixture guard: all edges of ${name} draw ${all} segments, not ${PLANE_COUNTS.all}`]),
      ...(border === PLANE_COUNTS.border ? [] : [`fixture guard: crease edges of ${name} with border draw ${border} segments, not ${PLANE_COUNTS.border}`]),
    ];
  });
}

/** Both documents in one run: the guards are held first, then the material lines' frame is returned. */
function drawn(startup: Startup): { frame: Frame; what: string } {
  const what = `the planes on ${startName(startup)}`;
  const [guards, lines] = run(bin(), dir(), [viewCall(dir(), GUARDS()), viewCall(dir(), MATERIAL())], startup);
  none(guardProblems(framesOf(guards!, `${what}, the guards`)[0]!, `${what}, the guards`), 'the fixture, as the base draws it');
  return { frame: framesOf(lines!, what)[0]!, what };
}

describe(`${AC[1]} material edges of a 2 × 2 plane whose columns are named parts`, () => {
  it(`${AC[1]} draws 2 end to end between the columns, 10 with border, 0 with one material and 4 with a material per quad (noop lane)`, () => {
    for (const c of CASES) expect(c.want.length, `the reference set of ${c.line} has the issue's count`).toBe(c.count);
    expect(planeParts('columns').concat(planeParts('quads')).map((m) => m.triangles.length), 'each plane has the issue\'s 8 triangles').toEqual([4, 4, 2, 2, 2, 2]);
    const { frame, what } = drawn(NOOP);
    none(CASES.flatMap((c) => caseProblems(c, segmentsOf(frame, c.line, what))), `${what}: material edges`);
  }, 600_000);

  it(`${AC[1]} a planted picker that keeps every edge two faces share draws 8 and fails, naming the item and the count (noop lane)`, () => {
    const { frame, what } = drawn({ backend: 'noop', planted: 'edges_material_every_shared' });
    const segs = segmentsOf(frame, 'columns', what);
    expect(segs.length, `${what}: the planted picker keeps the plane's ${PLANE_COUNTS.planted} edges that two faces share`).toBe(PLANE_COUNTS.planted);
    failsNaming(caseProblems(CASES[0]!, segs), [`of plane draw ${PLANE_COUNTS.planted} segments`], 'the picker that keeps every shared edge');
  }, 600_000);
});

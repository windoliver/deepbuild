// AC6 #224.bb45c6d2: "A plane x = u, y = v, z = 0 over u ∈ [−0.3, 1] and v ∈ [0, 1] with `grid_lines: {u: 0.25}` draws
// six lines, at u = −0.25, 0, 0.25, 0.5, 0.75 and 1, each along mesh edges whose vertices sit at that u within 1e-12; a
// planted twin that counts steps from the range's start draws them at u = −0.3, −0.05, 0.2 and on, and fails, naming
// the first line; `grid_lines` on an implicit surface is refused, naming the field"
//
// `plane`, the criterion's plane with `grid_lines: {u: 0.25, stroke}`. `geometry` answers its lines as `grid_lines`
// (README: The surface under test): one entry per line, `{u: value, edges: [[i, j]]}`, each edge two indices into the
// row's positions. Since x = u on this plane, a vertex's u is its x.
//   The judge, in line order (by value): six lines of constant u and none of constant v; line k at the k-th expected
//   value within 1e-12, else a failure naming "line k" and the value expected; each line's edges are edges of the
//   mesh's triangles, both ends at its u within 1e-12, and together they run the whole of v ∈ [0, 1].
//   - The shipped program passes it.
//   - `grid_lines_from_start` (the planted twin: lines at the range's start plus whole steps) draws lines at −0.3,
//     −0.05, 0.2, … within 1e-9, and the judge fails, its first failure naming line 1 and u = −0.25.
//   - `blob`, the unit sphere as an implicit surface, with `grid_lines: {u: 0.25}`, is refused with an error at
//     `items/blob/params/grid_lines`; without it, presented.
// Fails: lines counted from the range's start; lines that float off the mesh's edges; lines on an implicit surface.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, STROKE, TIMEOUT, UNIT_SPHERE_ZERO, admitted, ask, failsNaming, geometry, meshOf, none, present, refusedAt, sceneDoc, surface,
  useBins, zeroSurface, type Mesh, type Run,
} from './helpers.ts';

useBins();
const ID = AC[6];
const EXPECTED = [-0.25, 0, 0.25, 0.5, 0.75, 1];
const plane = surface({ fn: { x: 'u', y: 'v', z: '0' }, u: [-0.3, 1], v: [0, 1], grid_lines: { u: 0.25, stroke: STROKE } });

function drawn(o: Run = {}): Mesh {
  const [shownReply, geo] = ask([present(DOC(1), sceneDoc('A gridded plane', { plane })), geometry(DOC(1), ['plane'])], o);
  admitted(shownReply, 'the gridded plane');
  return meshOf(geo, 'plane', 'the gridded plane');
}

/** The judge: the six lines at whole multiples of 0.25, each along mesh edges at its u, spanning v ∈ [0, 1]. */
function gridFailures(m: Mesh): string[] {
  const f: string[] = [];
  const lines = m.gridLines.filter((l) => l.along === 'u').sort((a, b) => a.value - b.value);
  const others = m.gridLines.filter((l) => l.along === 'v');
  if (others.length) f.push(`${others.length} lines of constant v are drawn, with no v step`);
  EXPECTED.forEach((u, k) => {
    const line = lines[k];
    if (!line) f.push(`line ${k + 1}: expected at u = ${u}, none drawn`);
    else if (Math.abs(line.value - u) > 1e-12) f.push(`line ${k + 1}: expected at u = ${u}, drawn at u = ${line.value}`);
  });
  if (lines.length > EXPECTED.length) f.push(`${lines.length} lines are drawn, not six`);
  const meshEdges = new Set<string>();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
      const [i, j] = [m.indices[t + a]!, m.indices[t + b]!];
      meshEdges.add(i < j ? `${i},${j}` : `${j},${i}`);
    }
  }
  lines.forEach((line, k) => {
    const off = line.edges.filter(([i, j]) => !meshEdges.has(i < j ? `${i},${j}` : `${j},${i}`));
    if (off.length) f.push(`line ${k + 1} (u = ${line.value}): ${off.length} of its edges aren't mesh edges, such as ${JSON.stringify(off[0])}`);
    const stray = line.edges.flat().filter((i) => Math.abs(m.positions[i]![0] - line.value) > 1e-12);
    if (stray.length) f.push(`line ${k + 1} (u = ${line.value}): vertex ${stray[0]} sits at u = ${m.positions[stray[0]!]![0]}, off by more than 1e-12`);
    const spans = line.edges.map(([i, j]) => [Math.min(m.positions[i]![1], m.positions[j]![1]), Math.max(m.positions[i]![1], m.positions[j]![1])] as const).sort((a, b) => a[0] - b[0]);
    let reach = 0;
    for (const [lo, hi] of spans) if (lo <= reach + 1e-12) reach = Math.max(reach, hi);
    if (!spans.length || spans[0]![0] > 1e-12 || reach < 1 - 1e-12) f.push(`line ${k + 1} (u = ${line.value}): its edges run v ∈ [${spans[0]?.[0] ?? 'none'}, ${reach}], not the whole of [0, 1]`);
  });
  return f;
}

describe(`${ID} grid lines at whole multiples of a step`, () => {
  it(`${ID} the plane over u ∈ [−0.3, 1] with grid_lines {u: 0.25} draws six lines at u = −0.25 … 1, each along mesh edges at its u within 1e-12`, () => {
    none(gridFailures(drawn()), 'the gridded plane');
  }, TIMEOUT);

  it(`${ID} a planted twin that counts steps from the range's start (planted grid_lines_from_start) draws them at u = −0.3, −0.05, 0.2 and on, and fails, naming the first line`, () => {
    const m = drawn({ planted: 'grid_lines_from_start' });
    const at = m.gridLines.filter((l) => l.along === 'u').map((l) => l.value).sort((a, b) => a - b);
    expect(at.length > 3 && [-0.3, -0.05, 0.2].every((u, k) => Math.abs(at[k]! - u) <= 1e-9), `the twin draws lines from the range's start: ${JSON.stringify(at)}`).toBe(true);
    const failures = gridFailures(m);
    failsNaming(failures, ['line 1', 'u = -0.25'], 'grid_lines_from_start');
    expect(failures[0], 'the first failure names the first line').toContain('line 1:');
  }, TIMEOUT);

  it(`${ID} grid_lines on an implicit surface is refused, naming the field`, () => {
    const blob = (more = {}): Record<string, ReturnType<typeof surface>> => ({ blob: zeroSurface(UNIT_SPHERE_ZERO, 1.5, 0.05, more) });
    const [without, withLines] = ask([present(DOC(1), sceneDoc('An implicit sphere', blob())), present(DOC(2), sceneDoc('An implicit sphere with grid lines', blob({ grid_lines: { u: 0.25, stroke: STROKE } })))]);
    admitted(without, 'the implicit sphere without grid lines');
    refusedAt(withLines, 'items/blob/params/grid_lines', 'the implicit sphere with grid lines');
  }, TIMEOUT);
});

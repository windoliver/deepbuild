// AC3 #224.7f436e55: "`color: {by: z, ramp: [a, b, c], domain: [−1, 1]}` gives a vertex at z = 0 role b's color within
// OKLab ΔE 0.01; `checker {cells: [8, 8]}` gives 64 cells with no two edge neighbours sharing a role"
//
// Roles a, b and c are the suite's look's (README: The look): #1f5fbf, #2f9e44 and #d9480f, the document naming the look
// `look-224@1`. Colors are read from `geometry`'s `attributes.color` (README: The surface under test), OKLab [L, a, b];
// expected colors are each role's sRGB in OKLab by its published formula.
//   - Value: `ramp`, x = u, y = v, z = u·v over u ∈ [−1, 1], v ∈ [0, 1] (z spans the domain; its v = 0 edge is z = 0,
//     sampled whatever the refinement), `color: {by: z, ramp: [a, b, c], domain: [−1, 1]}`. Every vertex at z = 0 is role
//     b's color within ΔE 0.01, and there is one; the ramp's ends, z = −1 and z = 1, are a's and c's, so a surface of
//     one color can't pass.
//   - Checker: `board`, x = u, y = v, z = 0.1 sin πu sin πv over [0, 1]², `checker {roles: [a, b], cells: [8, 8]}`.
//     Each triangle has one color, a face's or its three corners' alike ("sharp at cell edges"); a triangle lies in the
//     cell (⌊8x⌋, ⌊8y⌋) of its centroid; every cell's triangles share one role's color within ΔE 0.01; there are 64
//     cells, and no two sharing an edge share a role.
// Fails: no color attribute; a ramp off its stops; a checker that blends across cell edges, has a cell of two colors,
// or stripes.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, LOOK_FIELDS, ROLE_COLORS, TIMEOUT, admitted, ask, atStops, colorsOf, deltaE, geometry, meshOf, none, oklab, present, sceneDoc, surface,
  useBins, type V3,
} from './helpers.ts';

useBins();
const ID = AC[3];

describe(`${ID} a surface colored by its value, and a checkered one`, () => {
  it(`${ID} color by z through [a, b, c] over [−1, 1] gives a vertex at z = 0 role b's color within OKLab ΔE 0.01`, () => {
    const ramp = surface({ fn: { x: 'u', y: 'v', z: 'u * v' }, u: [-1, 1], v: [0, 1], color: { by: 'z', ramp: ['a', 'b', 'c'], domain: [-1, 1] } });
    const [shownReply, geo] = ask([present(DOC(1), sceneDoc('Colored by its height', { ramp }, LOOK_FIELDS)), geometry(DOC(1), ['ramp'])]);
    admitted(shownReply, 'the value-colored surface');
    const m = meshOf(geo, 'ramp', 'the value-colored surface');
    const colors = colorsOf(m, 'the value-colored surface');
    expect(colors.domain, 'color by value is per vertex').toBe('point');
    const stops = [[0, 'b'], [-1, 'a'], [1, 'c']] as const;
    const { failures, counts } = atStops(m, colors.values, stops);
    stops.forEach(([z], k) => expect(counts[k], `the surface has a vertex at z = ${z}`).toBeGreaterThan(0));
    none(failures, 'every vertex at z = 0 has role b\'s color (and at z = −1 and 1, a\'s and c\'s) within OKLab ΔE 0.01');
  }, TIMEOUT);

  it(`${ID} checker {cells: [8, 8]} gives 64 cells with no two edge neighbours sharing a role`, () => {
    const board = surface({ fn: { x: 'u', y: 'v', z: '0.1 * sin(pi * u) * sin(pi * v)' }, u: [0, 1], v: [0, 1], checker: { roles: ['a', 'b'], cells: [8, 8] }, two_sided: false });
    const [shownReply, geo] = ask([present(DOC(1), sceneDoc('A checker', { board }, LOOK_FIELDS)), geometry(DOC(1), ['board'])]);
    admitted(shownReply, 'the checker');
    const m = meshOf(geo, 'board', 'the checker');
    const colors = colorsOf(m, 'the checker');
    const roles = { a: oklab(ROLE_COLORS['a']!), b: oklab(ROLE_COLORS['b']!) };
    const f: string[] = [];
    const cells = new Map<string, { color: V3; role: string | null }>();
    for (let t = 0; t < m.indices.length / 3; t++) {
      const corners = [0, 1, 2].map((k) => m.indices[3 * t + k]!);
      let color: V3;
      if (colors.domain === 'face') color = colors.values[t]!;
      else {
        const cs = corners.map((i) => colors.values[i]!);
        const spread = Math.max(deltaE(cs[0]!, cs[1]!), deltaE(cs[1]!, cs[2]!), deltaE(cs[0]!, cs[2]!));
        if (spread > 1e-6) { f.push(`triangle ${t}'s corners differ by ΔE ${spread.toFixed(4)}: the checker isn't sharp at the cell edges`); continue; }
        color = cs[0]!;
      }
      const c = corners.map((i) => m.positions[i]!);
      const [cx, cy] = [(c[0]![0] + c[1]![0] + c[2]![0]) / 3, (c[0]![1] + c[1]![1] + c[2]![1]) / 3];
      const key = `${Math.min(7, Math.floor(8 * cx))},${Math.min(7, Math.floor(8 * cy))}`;
      const cell = cells.get(key);
      if (!cell) {
        const role = (Object.entries(roles).find(([, lab]) => deltaE(lab, color) <= 0.01) ?? [null])[0];
        if (role === null) f.push(`cell (${key}) is ${JSON.stringify(color)} in OKLab, neither role a's nor b's color`);
        cells.set(key, { color, role });
      } else if (deltaE(cell.color, color) > 0.01) f.push(`cell (${key}) holds two colors, ${JSON.stringify(cell.color)} and ${JSON.stringify(color)}`);
    }
    none(f, 'each triangle lies in one checker cell, every cell one role\'s color');
    expect(cells.size, 'the checker has 64 cells').toBe(64);
    const shared: string[] = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        for (const [di, dj] of [[1, 0], [0, 1]] as const) {
          if (i + di > 7 || j + dj > 7) continue;
          const [p, q] = [cells.get(`${i},${j}`)?.role, cells.get(`${i + di},${j + dj}`)?.role];
          if (p === q) shared.push(`cells (${i}, ${j}) and (${i + di}, ${j + dj}) share an edge and role ${String(p)}`);
        }
      }
    }
    none(shared, 'no two edge neighbours share a role');
  }, TIMEOUT);
});

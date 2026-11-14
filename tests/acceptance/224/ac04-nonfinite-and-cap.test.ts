// AC4 #224.84d92ff1: "z = sqrt(u) over u ∈ [−1, 1] drops only the cells with u < 0 and raises `surface.nonfinite`
// naming that range; a stereographic torus through the pole drops its non-finite cells with the issue and never draws
// NaN; a `max` past the 262,144-vertex builder cap is refused, naming the grid"
//
// Issues are `deep_show`'s (the check samples the surface); `surface.nonfinite`'s `item`, `u` and `v` are read from the
// issue or its `actual` (README: The surface under test). Positions and normals come from `geometry`; JSON writes NaN as
// null, which the reader refuses.
//   - `root`: x = u, y = v, z = sqrt(u) over u ∈ [−1, 1], v ∈ [0, 1], one-sided. Nothing is drawn at u < 0 (every vertex
//     of every triangle has x = u ≥ −1e-12); the drawn region's area in the xy plane is 1 within 1e-9 (all of u ∈ [0, 1]
//     is kept); the `surface.nonfinite` issues naming `root` together name u ∈ [−1, 0], v ∈ [0, 1], within 1e-9.
//   - `torus`: a Clifford torus in the 3-sphere, turned 45° in its first and fourth coordinates and projected
//     stereographically from (0, 0, 0, 1), over u ∈ [0, 2π], v ∈ [π/2, 5π/2]: (x, y, z) = ((cos u − sin v) ÷ 2,
//     sin u ÷ √2, cos v ÷ √2) ÷ (1 − (cos u + sin v) ÷ 2). It passes through the pole at the range's four corners, which
//     every grid samples, where the denominator is 0. A `surface.nonfinite` issue names `torus` and a range holding a
//     corner; every position and normal drawn is finite.
//   - `huge`: the unit sphere with `max: [1024, 1024]` is refused, with an error at `items/huge/params/max`; with
//     `max: [256, 256]` (the default) it is presented.
// Fails: no `surface@1`; cells dropped past u = 0 or kept below it; no issue or a wrong range; a NaN drawn; a grid past
// the cap built, or refused naming something else.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, PI, TAU, TIMEOUT, UNIT_SPHERE, admitted, arr, ask, fieldOf, geometry, isObject, meshOf, names, none, present, refusedAt, sceneDoc,
  shown, surface, useBins, type Issue, type JsonObject, type JsonValue,
} from './helpers.ts';

useBins();
const ID = AC[4];

/** A named range [lo, hi], read from an issue's field. */
function range(v: JsonValue | undefined, what: string): [number, number] {
  const a = arr(v ?? null, what);
  expect(a.length === 2 && a.every((x) => typeof x === 'number'), `${what} is [lo, hi], got ${shown(v)}`).toBe(true);
  return [Math.min(a[0] as number, a[1] as number), Math.max(a[0] as number, a[1] as number)];
}
const nonfinite = (list: Issue[], id: string): Issue[] => list.filter((i) => i.code === 'surface.nonfinite' && names(i, id));

describe(`${ID} non-finite samples and the builder cap`, () => {
  it(`${ID} z = sqrt(u) over u ∈ [−1, 1] drops only the cells with u < 0 and raises surface.nonfinite naming that range`, () => {
    const root = surface({ fn: { x: 'u', y: 'v', z: 'sqrt(u)' }, u: [-1, 1], v: [0, 1], two_sided: false });
    const [shownReply, geo] = ask([present(DOC(1), sceneDoc('The square root', { root })), geometry(DOC(1), ['root'])]);
    const issues = nonfinite(admitted(shownReply, 'the square root'), 'root');
    expect(issues.length, `surface.nonfinite names root: ${shown(issuesOfReply(shownReply))}`).toBeGreaterThan(0);
    const us = issues.map((i, k) => range(fieldOf(i, 'u'), `surface.nonfinite ${k}: u`));
    const vs = issues.map((i, k) => range(fieldOf(i, 'v'), `surface.nonfinite ${k}: v`));
    const span = (rs: [number, number][]): [number, number] => [Math.min(...rs.map((r) => r[0])), Math.max(...rs.map((r) => r[1]))];
    const [u, v] = [span(us), span(vs)];
    expect(Math.abs(u[0] + 1) <= 1e-9 && Math.abs(u[1]) <= 1e-9, `surface.nonfinite names u ∈ [−1, 0], got ${JSON.stringify(us)}`).toBe(true);
    expect(Math.abs(v[0]) <= 1e-9 && Math.abs(v[1] - 1) <= 1e-9, `surface.nonfinite names v ∈ [0, 1], got ${JSON.stringify(vs)}`).toBe(true);
    const m = meshOf(geo, 'root', 'the square root');
    const below = [...new Set(m.indices)].filter((i) => m.positions[i]![0] < -1e-12);
    none(below.slice(0, 5).map((i) => `vertex ${i} at u = ${m.positions[i]![0]} is drawn`), 'nothing is drawn where u < 0');
    let area = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => m.positions[m.indices[t + k]!]!);
      area += Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (b![1] - a![1])) / 2;
    }
    expect(Math.abs(area - 1), `the cells with u ≥ 0 are all kept: the drawn region covers [0, 1] × [0, 1], area ${area}`).toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);

  it(`${ID} a stereographic torus through the pole drops its non-finite cells with the issue and never draws NaN`, () => {
    const d = '(1 - (cos(u) + sin(v)) / 2)';
    const torus = surface({ fn: { x: `((cos(u) - sin(v)) / 2) / ${d}`, y: `(sin(u) / sqrt(2)) / ${d}`, z: `(cos(v) / sqrt(2)) / ${d}` }, u: [0, TAU], v: [PI / 2, PI / 2 + TAU] });
    const [shownReply, geo] = ask([present(DOC(1), sceneDoc('A stereographic torus', { torus })), geometry(DOC(1), ['torus'])]);
    const issues = nonfinite(admitted(shownReply, 'the stereographic torus'), 'torus');
    expect(issues.length, `surface.nonfinite names torus: ${shown(issuesOfReply(shownReply))}`).toBeGreaterThan(0);
    const holds = (r: [number, number], xs: number[]): boolean => xs.some((x) => r[0] - 1e-9 <= x && x <= r[1] + 1e-9);
    const atPole = issues.some((i, k) => holds(range(fieldOf(i, 'u'), `surface.nonfinite ${k}: u`), [0, TAU]) && holds(range(fieldOf(i, 'v'), `surface.nonfinite ${k}: v`), [PI / 2, PI / 2 + TAU]));
    expect(atPole, `a surface.nonfinite issue names a range through the pole (u ∈ {0, 2π}, v ∈ {π/2, 5π/2}): ${shown(issues.map((i) => i.raw))}`).toBe(true);
    // meshOf refuses any position or normal that isn't a finite number.
    const m = meshOf(geo, 'torus', 'the stereographic torus');
    expect(m.indices.length, 'the torus away from the pole is drawn').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ID} a max past the 262,144-vertex builder cap is refused, naming the grid`, () => {
    const at = (n: number, max: [number, number]): JsonObject => present(DOC(n), sceneDoc('A sphere on a big grid', { huge: surface({ ...UNIT_SPHERE, max }) }));
    const [fits, past] = ask([at(1, [256, 256]), at(2, [1024, 1024])]);
    admitted(fits, 'the sphere on the default 256 × 256 grid');
    refusedAt(past, 'items/huge/params/max', 'the sphere with max [1024, 1024]');
  }, TIMEOUT);
});

function issuesOfReply(reply: JsonValue | undefined): JsonValue {
  return isObject(reply) ? (reply['issues'] ?? null) : null;
}

// AC2 #224.e2f417bd: "A helicoid-to-catenoid family with θ on a slider rebuilds a 128 × 128 grid within 2 ms on the
// reference Mac, a seek to a slider entry gives the same vertex hash as playing to it, and its two marked curves keep
// their lengths within 1e-4 relative, read from evaluated data"
//
// The two untimed parts; the 2 ms rebuild is ac02-rebuild-budget.test.ts (a timed file). `family`, a `surface@1` of the
// associate family (README: Fixtures) over u ∈ [−π/2, π/2], v ∈ [−1, 1], `max: [128, 128]`, tolerance 1e-5 m (so the
// build reaches its 128 × 128 grid), θ bound to the document slider `theta` over [0, π/2] (`vars: {theta:
// "controls/theta/value"}`, as 2D path@1's fn names a control), and `grid_lines: {u: 2, v: 2}`: the two marked curves,
// the line u = 0 (along v) and the line v = 0 (along u). Your input track moves θ to π/8, π/4, 3π/8 and π/2 at 0.25,
// 0.5, 0.75 and 1 s.
//   - Seek equals play: at each entry's time, `geometry` at that time (a clean evaluation: the seek) and `geometry` with
//     `play: {fps: 20}` (every frame from 0 played in order through the session: the play) give the same vertex hash
//     (README: The vertex hash). The slider drives the formula: at 0 s every vertex is on the helicoid (x cos z +
//     y sin z = 0), after the last entry on the catenoid (x² + y² = cosh² z), and the first entry changes the hash.
//   - Lengths: the family is an isometry, so at 0 s and at each entry the line u = 0 is 2 sinh 1 m long and the line
//     v = 0 is π m long, each within 1e-4 relative, summed over the mesh edges `geometry` lists for the line.
// Fails: no `surface@1` or no slider var; a played build that differs from the seek; a surface that ignores θ; marked
// curves off their isometric lengths (a coarse grid, a family that stretches).
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, PI, THETA, TIMEOUT, admitted, ask, dist, family, geometry, meshOf, none, present, sceneDoc, thetaEntry, useBins, vertexHash,
  type GridLine, type JsonObject, type Mesh,
} from './helpers.ts';

useBins();
const ID = AC[2];
const ENTRIES = [0.25, 0.5, 0.75, 1];
const thetaAt = (k: number): number => ((PI / 2) * k) / 4;
const TRACK = ENTRIES.map((s, i) => thetaEntry(s, i + 1, thetaAt(i + 1)));
const fl = (s: number): number => Math.round(s * FLICKS);
const doc = (): JsonObject => sceneDoc('The helicoid-to-catenoid family', { family: family([-PI / 2, PI / 2], { u: 2, v: 2 }) }, { controls: { theta: THETA } });

/** The vertices off a closed form: at most the first few, each named. */
function offSurface(m: Mesh, residual: (p: readonly number[]) => number, what: string): string[] {
  const bad = m.positions.map((p, i) => [i, residual(p)] as const).filter(([, r]) => !(r <= 1e-9));
  return bad.slice(0, 5).map(([i, r]) => `${what}: vertex ${i} at ${JSON.stringify(m.positions[i])} is ${r.toExponential(2)} off`).concat(bad.length > 5 ? [`… ${bad.length} vertices in all`] : []);
}

/** A grid line's length: its mesh edges, each counted once by its welded ends. */
function lineLength(m: Mesh, l: GridLine): number {
  const key = (i: number): string => m.positions[i]!.map((c) => Math.round(c / 1e-9)).join(',');
  const seen = new Set<string>();
  let sum = 0;
  for (const [i, j] of l.edges) {
    const [a, b] = [key(i), key(j)].sort();
    if (seen.has(`${a}|${b}`)) continue;
    seen.add(`${a}|${b}`);
    sum += dist(m.positions[i]!, m.positions[j]!);
  }
  return sum;
}

describe(`${ID} the helicoid-to-catenoid family on a slider`, () => {
  it(`${ID} a seek to each slider entry gives the same vertex hash as playing to it`, () => {
    const calls = [present(DOC(1), doc()), geometry(DOC(1), ['family'], 0, { track: TRACK })];
    for (const s of ENTRIES) calls.push(geometry(DOC(1), ['family'], fl(s), { track: TRACK }), geometry(DOC(1), ['family'], fl(s), { track: TRACK, play: { fps: 20 } }));
    const r = ask(calls);
    admitted(r[0], 'the family');
    const start = meshOf(r[1], 'family', 'the family at 0 s');
    const f: string[] = [];
    const seeks = ENTRIES.map((s, k) => {
      const seek = meshOf(r[2 + 2 * k], 'family', `the seek to ${s} s`);
      const play = meshOf(r[3 + 2 * k], 'family', `playing to ${s} s`);
      const [hs, hp] = [vertexHash(seek), vertexHash(play)];
      if (hs !== hp) f.push(`the slider entry at ${s} s (θ = ${thetaAt(k + 1)}): the seek gives vertex hash ${hs}, playing to it ${hp}`);
      return seek;
    });
    none(f, 'a seek to each slider entry gives the same vertex hash as playing to it');
    none(offSurface(start, (p) => Math.abs(p[0]! * Math.cos(p[2]!) + p[1]! * Math.sin(p[2]!)), 'at 0 s, θ = 0, the helicoid x cos z + y sin z = 0'), 'before any entry the family is the helicoid');
    const last = seeks[seeks.length - 1]!;
    none(offSurface(last, (p) => Math.abs(p[0]! ** 2 + p[1]! ** 2 - Math.cosh(p[2]!) ** 2) / Math.cosh(p[2]!) ** 2, 'after θ = π/2, the catenoid x² + y² = cosh² z'), 'after the last entry the family is the catenoid');
    expect(vertexHash(seeks[0]!), 'the first slider entry changes the family').not.toBe(vertexHash(start));
  }, TIMEOUT);

  it(`${ID} its two marked curves, the lines u = 0 and v = 0, keep their lengths within 1e-4 relative, read from evaluated data`, () => {
    const times = [0, ...ENTRIES];
    const r = ask([present(DOC(1), doc()), ...times.map((s) => geometry(DOC(1), ['family'], fl(s), { track: TRACK }))]);
    admitted(r[0], 'the family');
    const f: string[] = [];
    times.forEach((s, k) => {
      const m = meshOf(r[1 + k], 'family', `the family at ${s} s`);
      const theta = k === 0 ? 0 : thetaAt(k);
      for (const [along, closed] of [['u', 2 * Math.sinh(1)], ['v', PI]] as const) {
        const lines = m.gridLines.filter((l) => l.along === along);
        if (lines.length !== 1 || Math.abs(lines[0]!.value) > 1e-12) { f.push(`at θ = ${theta}: the marked lines of constant ${along} are ${JSON.stringify(lines.map((l) => l.value))}, not the one at ${along} = 0`); continue; }
        const length = lineLength(m, lines[0]!);
        const rel = Math.abs(length - closed) / closed;
        if (!(rel <= 1e-4)) f.push(`at θ = ${theta}: the marked curve ${along} = 0 is ${length} m long, ${rel.toExponential(3)} relative from its length ${closed} m`);
      }
    });
    none(f, 'the two marked curves keep their lengths within 1e-4 relative through the morph');
  }, TIMEOUT);
});

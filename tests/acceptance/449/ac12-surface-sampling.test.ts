// AC12: "65,536 particles born on a fixture of a unit cube and a sphere lie within 1e-5 m of the surface, their counts
// per face pass a fixed chi-squared bound at 99% against face area, and adding a particle moves no other; a planted
// sampler that picks triangles uniformly rather than by area fails the bound, naming the face"
//
// The cube and the sphere (helpers.ts: shapesDoc): two still meshes in the collection `shapes`, whose surface the item
// `grit` names (`emit.shape: {surface: {of: "shapes"}}`), bursting 65,536 particles at 0 s that hold still. The
// `particles` call reads every row's CPU f64 position at 1 s, its birth point. Each must lie within 1e-5 m of the
// nearest of the meshes' 236 triangles as the test places them; a face is a triangle, and the particles' counts per
// face, against expected counts in proportion to each face's area, must give a Pearson statistic under the fixed 99%
// bound for 235 degrees of freedom. The same document with the burst raised to 65,537 must leave rows 0 to 65,535
// where they were, bit for bit, and put row 65,536 on the surface too. The planted `surface_triangles_uniform` (README:
// Criteria 12 to 16) fails the bound, in a failure that names its worst face.

import { describe, it } from 'vitest';
import {
  TIMEOUT, acSurface, chi2Bound99, chiSquared, failsNaming, flicks, fmt, fmtV, nearestFace, none, particlesCall, passed, reading,
  runGpuSurface, shapeFaces, shapesDoc, useBins, useDir, writeJson, type SurfacePlanted, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const N = 65_536;
const AT = flicks(1);
/** "Within 1e-5 m of the surface". */
const ON = 1e-5;

/** Everything the criterion asks of the fixture, as sentences; the bound's failure names its worst face. */
function samplingProblems(planted?: SurfacePlanted): string[] {
  const counts = [N, N + 1];
  const calls = counts.map((n) => particlesCall({ doc: writeJson(dir(), `shapes-${n}.json`, shapesDoc(n)), t: [AT] }));
  const replies = runGpuSurface(bins.bin('deep-gpu'), dir(), calls, { backend: 'noop', ...(planted ? { planted } : {}) });
  const [base, more] = replies.map((r, i) => {
    const what = `the cube and the sphere with ${counts[i]} particles`;
    return reading(passed(r, calls[i]!, what), 'grit', what).at[0]!.cpu;
  }) as [(V3 | null)[], (V3 | null)[]];
  const faces = shapeFaces();
  const out: string[] = [];
  const live = base.flatMap((p, row) => (p === null ? [] : [[row, p] as const]));
  if (live.length !== N) out.push(`${live.length} of the ${N} particles burst at 0 s are live at 1 s`);
  const perFace = faces.map(() => 0);
  const off: string[] = [];
  for (const [row, p] of live) {
    const [k, d] = nearestFace(faces, p);
    perFace[k]! += 1;
    if (d > ON) off.push(`particle row ${row} at ${fmtV(p, 9)} lies ${d} m from the nearest face, ${faces[k]!.name}`);
  }
  if (off.length) out.push(`${off.length} of ${live.length} particles lie more than 1e-5 m from the surface; first ${off[0]}`);
  const total = faces.reduce((s, f) => s + f.area, 0);
  const probs = faces.map((f) => f.area / total);
  const stat = chiSquared(perFace, probs);
  const bound = chi2Bound99(faces.length - 1);
  if (live.length && !(stat < bound)) {
    const share = (k: number): number => (perFace[k]! - live.length * probs[k]!) ** 2 / (live.length * probs[k]!);
    const worst = faces.reduce((w, _, k) => (share(k) > share(w) ? k : w), 0);
    out.push(`the counts per face give chi-squared ${fmt(stat, 3)} over ${faces.length} faces against their areas, past the fixed 99% bound ${fmt(bound, 3)} (df ${faces.length - 1}); worst face ${faces[worst]!.name} (area ${fmt(faces[worst]!.area, 6)} m²): ${perFace[worst]} particles where ${fmt(live.length * probs[worst]!, 1)} are expected`);
  }
  const moved = base.flatMap((p, i) => (JSON.stringify(p) === JSON.stringify(more[i] ?? null) ? [] : [i]));
  if (moved.length) out.push(`adding a 65,537th particle moves ${moved.length} others, first row ${moved[0]} from ${fmtV(base[moved[0]!] ?? null, 12)} to ${fmtV(more[moved[0]!] ?? null, 12)}`);
  const added = more[N] ?? null;
  if (more.length !== N + 1 || added === null) out.push('with a burst of 65,537 its row 65,536 holds no live particle at 1 s');
  else if (nearestFace(faces, added)[1] > ON) out.push(`the added particle, row 65,536, lies ${nearestFace(faces, added)[1]} m from the surface`);
  return out;
}

describe(`${acSurface(12)} particles born on a cube and a sphere lie on the surface, spread by face area, and adding one moves no other`, () => {
  it(`${acSurface(12)} 65,536 particles lie within 1e-5 m of the surface, their counts per face pass the fixed 99% chi-squared bound against face area, and a 65,537th moves none of them`, () => {
    none(samplingProblems(), 'the cube and the sphere');
  }, TIMEOUT);

  it(`${acSurface(12)} the planted sampler that picks triangles uniformly rather than by area fails the bound, naming the face`, () => {
    failsNaming(samplingProblems('surface_triangles_uniform'), ['worst face '], 'the planted surface_triangles_uniform');
  }, TIMEOUT);
});

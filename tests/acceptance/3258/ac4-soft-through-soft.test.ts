// #3258.5e7ec8a8: "On that build, a cloth of 11 × 11 particles let go over a second, pinned one set half a cell aside each
// way fails, naming both soft bodies, the first particle and the face it met. A rope written as two passes that cross 2 cm
// apart, each at the middle of an edge, the lower pinned and the upper let go, fails with `self_contacts: true`, naming
// both edges; with it off the audit passes and `self_through` reads the count the failure gave"
//
// The cloths: 0.1 m cells, the pinned one level at y = 0, the other level 0.5 m over it and 5 cm aside along x and z, so each
// of its particles falls through the middle of a cell of the pinned one, all in step 39 (4.9 mm over it before, 21.4 mm under
// it after). The pinned cloth's particles pass the falling one's faces in that step too, and a cell's middle is on the
// diagonal its two faces share, so more than one particle and face is a right answer: the failure's particle and face are
// held to the motion the same build bakes, which must show that particle pass through that face, of the other cloth, in
// the first step any does.
//
// The rope: particles 0 to 9 along x at y = 0, pinned, and 10 to 19 along z 2 cm over them, two chains of edges 0.05 m long
// with no edge between them. The upper falls level, 2.7 mm over the lower after step 7 and 2.5 mm under it after step 8, so
// edge 14–15's middle passes edge 4–5's middle in step 8 and no other two edges meet: one way through.
import { describe, expect, it } from 'vitest';
import {
  AC, LOWER, PASSES, PASS_GAP, ROPE, ROPE_Y, TIMEOUT, UPPER, audit, bakes, cleanBuilds, crossedRope, edgeOf, faceOf, failFailures, fallStep,
  fallen, full, none, otherEdgeOf, particleOf, passFailures, pathsOf, readOf, show, softsOf, swapped, told, twoCloths, type V3,
} from './helpers.ts';

cleanBuilds();
const ID = AC[4];
const STEPS = 60;
const CLOTHS = 'the two cloths';
const SIDE = 11;

type Paths = Record<string, V3[][]>;
/** A cloth particle's address as its cloth, row and column. */
function at(address: string): { cloth: string; r: number; c: number } | null {
  const m = /^(\w+)#r(\d+)c(\d+)$/.exec(address);
  return m ? { cloth: m[1]!, r: Number(m[2]), c: Number(m[3]) } : null;
}
/** Everything wrong with "particle `p` passed through face `f` in step `k`": `f` half a cell of the other cloth, `p` on one side of it before the step and on the other after, inside it as seen from above. */
function passedFailures(paths: Paths, p: string, f: string[], k: number): string[] {
  const [a, corners] = [at(p), f.map(at)];
  if (!a || corners.some((c) => !c)) return [`${CLOTHS}: the failure names particle ${p} and face ${f.join(', ')}, not addresses r{row}c{col} of the two cloths`];
  const cs = corners as { cloth: string; r: number; c: number }[];
  const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
  if (cs.some((c) => c.cloth !== cs[0]!.cloth) || cs[0]!.cloth === a.cloth) return [`${CLOTHS}: the failure names particle ${p} and face ${f.join(', ')}, not a face of the other cloth`];
  if (new Set(f).size !== 3 || spread(cs.map((c) => c.r)) !== 1 || spread(cs.map((c) => c.c)) !== 1) return [`${CLOTHS}: ${f.join(', ')} is no face: three corners of one cell`];
  const where = (x: { cloth: string; r: number; c: number }, step: number): V3 => paths[x.cloth]![step]![x.r * SIDE + x.c]!;
  const height = (step: number): number => where(a, step)[1] - where(cs[0]!, step)[1];
  if (!(height(k - 1) * height(k) < 0)) return [`${CLOTHS}: ${p} is ${height(k - 1)} m over the face ${f.join(', ')} before step ${k} and ${height(k)} m after it, so it didn't pass it then`];
  const q = where(a, k);
  const [u, v, w] = cs.map((c) => where(c, k)) as [V3, V3, V3];
  const side = (s: V3, t: V3): number => ((t[0] - s[0]) * (q[2] - s[2]) - (t[2] - s[2]) * (q[0] - s[0])) / Math.hypot(t[0] - s[0], t[2] - s[2]);
  const sides = [side(u, v), side(v, w), side(w, u)];
  return sides.every((x) => x >= -1e-5) || sides.every((x) => x <= 1e-5) ? [] : [`${CLOTHS}: ${p} passes outside the face ${f.join(', ')} (${sides.map((x) => x.toFixed(4)).join(', ')} m from its sides)`];
}

describe(`${ID} soft bodies that pass through each other, or through themselves, fail the audit`, () => {
  it(`${ID} a cloth let go over a pinned second set half a cell aside fails, naming both soft bodies, the first particle and the face it met`, () => {
    const w = twoCloths();
    const [baked, reply] = swapped([bakes(w, STEPS), audit(w, STEPS)]);
    const paths: Paths = { [LOWER]: pathsOf(baked, LOWER, STEPS, CLOTHS), [UPPER]: pathsOf(baked, UPPER, STEPS, CLOTHS) };
    const step = fallStep(ROPE_Y);
    const heights = (k: number): number[] => paths[UPPER]![k]!.map((p) => p[1]);
    expect([step, heights(step - 1).filter((y) => y > 0).length, heights(step).filter((y) => y < 0).length], 'the fixture: the whole cloth is over the pinned one until step 39 and under it from there').toEqual([39, SIDE * SIDE, SIDE * SIDE]);
    const r = readOf(reply, CLOTHS);
    console.log(`${CLOTHS}: ${told({ ...r, rows: r.rows.slice(0, 3) })} (${r.rows.length} in all)`);
    const failures = failFailures(r, STEPS, CLOTHS);
    const first = r.rows.find((f) => particleOf(f) !== null);
    if (!first) failures.push(`${CLOTHS}: no failure names a particle`);
    else {
      const face = faceOf(first);
      if (JSON.stringify(softsOf(first)) !== JSON.stringify([LOWER, UPPER])) failures.push(`${CLOTHS}: the failure names the soft bodies ${show(softsOf(first))}, not ${LOWER} and ${UPPER}: ${show(first)}`);
      if (first['step'] !== step) failures.push(`${CLOTHS}: the first particle through is named at step ${show(first['step'])}, not ${step}`);
      else if (!face) failures.push(`${CLOTHS}: the failure names no face it met: ${show(first)}`);
      else failures.push(...passedFailures(paths, particleOf(first)!, face, step));
    }
    none(failures, 'the audit of the two cloths');
  }, 2 * TIMEOUT);

  it(`${ID} a rope's two passes that cross at the middle of an edge each fail with self_contacts: true, naming both edges, and with it off the audit passes and self_through reads the count the failure gave`, () => {
    const [on, off] = [crossedRope(true), crossedRope(false)];
    const steps = 20;
    const [baked, whenOn, whenOff] = swapped([bakes(on, steps), audit(on, steps), audit(off, steps)]);
    const path = pathsOf(baked, ROPE, steps, 'the rope\'s two passes');
    const step = fallStep(PASS_GAP);
    const upper = (k: number): number[] => path[k]!.slice(10).map((p) => p[1]);
    expect([step, upper(step - 1).every((y) => Math.abs(y - (PASS_GAP - fallen(step - 1))) < 1e-5), upper(step).every((y) => y < -0.002)], 'the fixture: the upper pass is level, over the lower until step 8 and under it from there').toEqual([8, true, true]);

    const r = readOf(whenOn, 'self_contacts on');
    console.log(`self_contacts on: ${told(r)}`);
    const failures = failFailures(r, steps, 'self_contacts on');
    const edges = PASSES.map((e) => JSON.stringify(full(ROPE, e))).sort();
    for (const f of r.rows) {
      const named = [edgeOf(f), otherEdgeOf(f)].map((e) => JSON.stringify(e)).sort();
      if (JSON.stringify(named) !== JSON.stringify(edges)) failures.push(`self_contacts on: the failure names the edges ${named.join(' and ')}, not ${edges.join(' and ')}: ${show(f)}`);
      if (JSON.stringify(softsOf(f)) !== JSON.stringify([ROPE])) failures.push(`self_contacts on: the failure names the soft bodies ${show(softsOf(f))}, not ${ROPE} alone: ${show(f)}`);
      if (f['step'] !== step) failures.push(`self_contacts on: the edges are named at step ${show(f['step'])}, not ${step}`);
      if (f['measured'] !== 1) failures.push(`self_contacts on: the failure's count is ${show(f['measured'])}, not 1: one edge passes one other once`);
    }
    const s = readOf(whenOff, 'self_contacts off');
    console.log(`self_contacts off: ${told(s)}`);
    failures.push(...passFailures(s, 'self_contacts off'));
    if (s.self !== (r.rows[0]?.['measured'] ?? null) || s.self !== 1) failures.push(`self_contacts off: readings.self_through is ${show(s.self)}, not the count the failure gave with it on, ${show(r.rows[0]?.['measured'])}`);
    none(failures, 'the audit of the rope\'s two passes, with self_contacts on and off');
  }, 2 * TIMEOUT);
});

// AC6: "Six planes keep a particle in a box for max bounces: with planes listed x = 1, x = −1, y = 1, y = −1, z = 1 and
// z = −1 m, gravity 0, drag 0, restitution 1, friction 0 and max 4, a particle launched from the origin at (3, 2, 0.5)
// m/s bounces off x = 1 at 1/3 s, y = 1 at 1/2 s, x = −1 at 1 s and y = −1 at 3/2 s, its fourth and last, where it
// dies, or with then: rest stays at (0.5, −1, 0.75) m; at 100 random times before 3/2 s its CPU position equals the
// free path folded into [−1, 1] on each axis within 1e-9 m, and the compute operator's within 1e-4 m on one machine;
// seven planes are refused at check, naming the item; and a planted solver that tests only the first two planes lets
// the particle out through y = 1 and fails, naming the particle and the time"
//
// The box fixture (helpers.ts: boxDoc): one particle, `bead`, born by a burst at 0 s at the origin with launch
// velocity (3, 2, 0.5) m/s, in the issue's six planes (listed in its order, each normal pointing into the box). The
// `particles` call reads its CPU f64 closed form and the compute operator's captured columns at 100 random times before
// 1.5 s, and its CPU position at 1.6, 2 and 5 s. Its bounces are planes 0, 2, 1 and 3 (x = 1, y = 1, x = −1, y = −1) at
// 1/3, 1/2, 1 and 3/2 s within 1e-9 s; with then: die it ends at 1.5 s and isn't live after; with then: rest it rests at
// (0.5, −1, 0.75) m and stays there. A seventh plane is refused at check with an error issue naming bead. The planted
// `bounce_first_two_planes` (README: Planted programs) fails the CPU check, naming the particle and the time.

import { describe, expect, it } from 'vitest';
import {
  BOX_PLANES, BOX_VELOCITY, TIMEOUT, ac, boxDoc, checkOf, failsNaming, flicks, fmt, fmtV, fold, gap, none, particlesCall, passed,
  randomFlicks, reading, refusalsNaming, requireGpu, runGpu, secondsOf, show, useBins, useDir, writeJson,
  type Planted, type Reading, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const TIMES = randomFlicks(4496, 100, 0, 1.5);
const AFTER = [flicks(1.6), flicks(2), flicks(5)];
const HITS = [{ plane: 0, t: 1 / 3 }, { plane: 2, t: 1 / 2 }, { plane: 1, t: 1 }, { plane: 3, t: 3 / 2 }];
const REST: V3 = [0.5, -1, 0.75];
const folded = (t: number): V3 => BOX_VELOCITY.map((v) => fold(v * t)) as V3;

function box(then: 'die' | 'rest', s: { gpu?: boolean; planted?: Planted } = {}): Reading {
  const call = particlesCall({ doc: writeJson(dir(), `box-${then}.json`, boxDoc(then)), t: [...TIMES, ...AFTER], ...(s.gpu ? { gpu: true } : {}) });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { ...(s.gpu ? {} : { backend: 'noop' as const }), ...(s.planted ? { planted: s.planted } : {}) });
  return reading(passed(reply!, call, `the box, then: ${then}`), 'bead', `the box, then: ${then}`);
}

/** The CPU's bead against the folded free path, its bounces, and its end; each failure names the particle and the time. */
function cpuProblems(r: Reading, then: 'die' | 'rest'): string[] {
  const out: string[] = [];
  const p = r.particles[0];
  if (r.particles.length !== 1 || !p) return [`the box holds ${r.particles.length} particles, not the one bead`];
  for (const s of r.at.slice(0, TIMES.length)) {
    const t = secondsOf(s.t);
    const got = s.cpu[p.row] ?? null;
    const want = folded(t);
    if (got === null || gap(got, want) > 1e-9) out.push(`particle row ${p.row} at t = ${fmt(t, 9)} s: the CPU places it at ${fmtV(got, 9)}, the folded free path at ${fmtV(want, 9)}`);
  }
  const hits = p.hits.map((h) => ({ plane: h.plane, t: h.t }));
  if (hits.length !== 4 || hits.some((h, k) => h.plane !== HITS[k]!.plane || Math.abs(h.t - HITS[k]!.t) > 1e-9)) {
    out.push(`particle row ${p.row}: bounces ${show(hits)}; the issue's are planes 0, 2, 1, 3 at t = 1/3, 1/2, 1 and 3/2 s`);
  }
  for (const s of r.at.slice(TIMES.length)) {
    const t = secondsOf(s.t);
    const got = s.cpu[p.row] ?? null;
    if (then === 'die' && got !== null) out.push(`particle row ${p.row} at t = ${fmt(t, 3)} s is still live at ${fmtV(got)}; it dies at its fourth bounce, 1.5 s`);
    if (then === 'rest' && (got === null || gap(got, REST) > 1e-9)) out.push(`particle row ${p.row} at t = ${fmt(t, 3)} s is at ${fmtV(got, 9)}; it rests at (0.5, −1, 0.75) m`);
  }
  if (then === 'die' && Math.abs(p.ends - 1.5) > 1e-9) out.push(`particle row ${p.row} ends at t = ${fmt(p.ends, 9)} s, not at its fourth bounce, 1.5 s`);
  if (then === 'rest' && (p.rest === null || gap(p.rest.at, REST) > 1e-9 || Math.abs(p.rest.t - 1.5) > 1e-9)) out.push(`particle row ${p.row} rests ${show(p.rest)}, not at (0.5, −1, 0.75) m from t = 1.5 s`);
  return out;
}

describe(`${ac(6)} six planes keep a particle in a box for max bounces`, () => {
  it(`${ac(6)} (CPU) the bead bounces off x = 1, y = 1, x = −1 and y = −1 at 1/3, 1/2, 1 and 3/2 s and dies there, or rests at (0.5, −1, 0.75) m, and at 100 random times before 1.5 s sits on the folded free path within 1e-9 m`, () => {
    none(cpuProblems(box('die'), 'die'), 'the bead, then: die');
    none(cpuProblems(box('rest'), 'rest'), 'the bead, then: rest');
  }, TIMEOUT);

  it(`${ac(6)} (compute operator) at the same 100 times the captured columns hold the bead on the folded free path within 1e-4 m`, () => {
    requireGpu();
    const r = box('die', { gpu: true });
    const fails: string[] = [];
    for (const s of r.at.slice(0, TIMES.length)) {
      const t = secondsOf(s.t);
      const got = s.gpu![0] ?? null;
      const want = folded(t);
      if (got === null || gap(got, want) > 1e-4) fails.push(`particle row 0 at t = ${fmt(t, 6)} s: the compute operator's columns hold ${fmtV(got)}, the folded free path ${fmtV(want)}`);
    }
    none(fails, 'the compute operator\'s bead');
  }, TIMEOUT);

  it(`${ac(6)} (seven planes) a seventh plane is refused at check, naming the item`, () => {
    const call = particlesCall({ doc: writeJson(dir(), 'box-seven.json', boxDoc('die', [...BOX_PLANES, { normal: [0, 1, 0], offset: -1.5 }])) });
    const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop' });
    const c = checkOf(reply!, call, 'seven planes');
    expect(c.outcome, `seven planes are refused at check: ${show(c.raw)}`).toBe('refused');
    expect(refusalsNaming(c, 'bead').length, `an error issue names bead: ${show(c.issues.map((i) => i.raw))}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ac(6)} (planted) a solver that tests only the first two planes lets the bead out through y = 1 and fails, naming the particle and the time`, () => {
    failsNaming(cpuProblems(box('die', { planted: 'bounce_first_two_planes' }), 'die'), ['particle row 0 at t = '], 'the planted bounce_first_two_planes');
  }, TIMEOUT);
});

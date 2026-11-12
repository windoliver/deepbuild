// AC8: "On one machine, the compute operator's columns, captured by the test harness at 100 times with bursts, bounces
// and turbulence on, match the CPU f64 evaluation within 1e-4 of the emitter's extent; a planted kernel with first-order
// drag fails, naming the particle"
//
// The storm (below): 1,024 particles in two bursts of 512 (at 0.1 and 0.9 s) from a 0.1 m ball, launched 2 to 5 m/s up a
// cone under gravity with drag 0.8/s, bouncing in a 3 m open box (a floor y = −1 and walls x, z = ±1.5; restitution
// 0.6, friction 0, at most 4 bounces, then rest), with turbulence of strength 0.15 m. The `particles` call captures the
// compute operator's instance columns after its dispatch at 100 random times in (0, 3.5) s and evaluates the CPU f64
// closed form at the same times. The emitter's extent is the largest side of the box that holds every position the
// CPU gives at those times; every row must agree within 1e-4 of it: the same rows live, and each live row's position
// within that distance. A row whose CPU birth or end lies within 1e-5 s of the time is let off its live state alone
// (f32 time against f64). Guards: both bursts are live at some time, and some particles have bounced. The planted
// `drag_first_order` (README: Planted programs) changes the compute operator alone and fails, naming the particle.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, camera, failsNaming, fmt, fmtV, gap, liveRows, none, particlesCall, particlesItem, passed, planeJson, randomFlicks,
  reading, requireGpu, runGpu, secondsOf, sessionDoc, useBins, useDir, writeJson, SPARK_LOOK, type JsonObject, type Planted, type Plane,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const TIMES = randomFlicks(4498, 100, 0, 3.5);
const WALLS: Plane[] = [
  { normal: [0, 1, 0], offset: -1 },
  { normal: [-1, 0, 0], offset: -1.5 }, { normal: [1, 0, 0], offset: -1.5 },
  { normal: [0, 0, -1], offset: -1.5 }, { normal: [0, 0, 1], offset: -1.5 },
];
function stormDoc(): JsonObject {
  return sessionDoc('Storm', {
    cam: camera([0, 2, 7], [0, 0, 0], 50),
    storm: particlesItem({
      count: 1024, emit: { shape: 'sphere', radius: 0.1, bursts: [{ t: '0.1s', count: 512 }, { t: '0.9s', count: 512 }] }, life: [1.5, 2.5],
      motion: {
        ballistic: { v0: [2, 5], gravity: [0, -9.81, 0], drag: 0.8 },
        bounce: { planes: WALLS.map(planeJson), restitution: 0.6, friction: 0, max: 4, then: 'rest' },
      },
      turbulence: { strength: 0.15, frequency: 1, paths: 32, steps: 64, travel: 4, seed: 3 },
      draw: 'dot', ...SPARK_LOOK,
    }),
  }, { transport: { span: '4s' } });
}

/** The compute operator's rows against the CPU's at every time; each failure names the particle and the time. */
function columnProblems(planted?: Planted): string[] {
  const call = particlesCall({ doc: writeJson(dir(), 'storm.json', stormDoc()), t: TIMES, gpu: true });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], planted ? { planted } : {});
  const r = reading(passed(reply!, call, 'the storm'), 'storm', 'the storm');
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const s of r.at) for (const p of s.cpu) if (p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
  const extent = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  const tol = 1e-4 * extent;
  const out: string[] = [];
  expect(extent, 'the storm spreads out over the box').toBeGreaterThan(1);
  const near = (row: number, t: number): boolean => r.particles.some((p) => p.row === row && (Math.abs(p.born - t) < 1e-5 || Math.abs(p.ends - t) < 1e-5));
  expect(r.particles.some((p) => p.hits.length > 0), 'some particles bounce').toBe(true);
  expect(r.at.filter((s) => liveRows(s.cpu).length > 0).length, 'particles are live at most of the times read').toBeGreaterThan(50);
  expect(new Set(r.particles.map((p) => Math.round(p.born * 10))), 'the two bursts are born at 0.1 and 0.9 s').toEqual(new Set([1, 9]));
  for (const s of r.at) {
    const t = secondsOf(s.t);
    for (let row = 0; row < r.count; row++) {
      const c = s.cpu[row] ?? null; const g = s.gpu![row] ?? null;
      if ((c === null) !== (g === null)) {
        if (!near(row, t)) out.push(`particle row ${row} at t = ${fmt(t, 6)} s: live on the ${c ? 'CPU' : 'GPU'} only (CPU ${fmtV(c)}, GPU ${fmtV(g)})`);
        continue;
      }
      if (c && g && gap(c, g) > tol) out.push(`particle row ${row} at t = ${fmt(t, 6)} s: the compute operator's columns hold ${fmtV(g)}, the CPU f64 ${fmtV(c)}, ${fmt(gap(c, g), 6)} m apart, past ${fmt(tol, 6)} m`);
    }
  }
  return out;
}

describe(`${ac(8)} the compute operator's columns match the CPU f64 evaluation within 1e-4 of the emitter's extent`, () => {
  it(`${ac(8)} at 100 times, with two bursts, five bounce planes and turbulence on, every row of the captured columns matches the CPU's`, () => {
    requireGpu();
    none(columnProblems(), 'the storm\'s compute columns against the CPU');
  }, TIMEOUT);

  it(`${ac(8)} the planted kernel with first-order drag fails, naming the particle`, () => {
    requireGpu();
    failsNaming(columnProblems('drag_first_order'), ['particle row'], 'the planted drag_first_order');
  }, TIMEOUT);
});

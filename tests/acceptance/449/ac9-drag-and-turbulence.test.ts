// AC9: "With drag 2/s and gravity (0, −9.81, 0), a particle launched at (4, 6, 0) m/s is at x = 2(1 − e^(−2t)) and
// y = 5.4525(1 − e^(−2t)) − 4.905t at 100 random times within 1e-9 m on the CPU; a planted form that integrates drag by
// Euler at 1/120 s fails. Doubling turbulence strength doubles every particle's offset from its turbulence-free position
// within 1e-9, strength 0 equals no turbulence bit for bit, and seeds 1 and 2 give different tables; a planted table of
// zeros fails"
//
// Drag: one particle, `shot`, born by a burst at 0 s at the origin with launch velocity (4, 6, 0) m/s, gravity
// (0, −9.81, 0), drag 2/s; its CPU f64 position at 100 random times in (0, 3) s against the issue's x and y (and z = 0)
// within 1e-9 m. Turbulence: the smoke fixture (helpers.ts: smokeDoc, 256 particles) with no turbulence, and with
// seed 1 at strength 0, 0.3 and 0.6 m, and seed 2 at 0.3 m, read at 50 random times in (0, 4) s: each live particle's
// offset at 0.6 is twice its offset at 0.3 within 1e-9 m on each axis, strength 0 gives the turbulence-free positions
// exactly, the offsets at 0.3 aren't all zero (more than 1 mm somewhere), and the two seeds' table hashes differ. The
// planted `drag_euler_120` and `turbulence_table_zeros` (README: Planted programs) each fail.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, camera, failsNaming, fmt, fmtV, none, particlesCall, particlesItem, passed, randomFlicks, reading, runGpu,
  secondsOf, sessionDoc, smokeDoc, useBins, useDir, writeJson, SPARK_LOOK, type Planted, type Reading,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();

function shotProblems(planted?: Planted): string[] {
  const doc = sessionDoc('Shot with drag', {
    cam: camera([1, 0.5, 6], [1, 0.5, 0], 50),
    shot: particlesItem({
      count: 1, emit: { shape: 'point', bursts: [{ t: '0s', count: 1 }] }, life: [10, 10],
      motion: { ballistic: { velocity: [4, 6, 0], gravity: [0, -9.81, 0], drag: 2 } }, draw: 'dot', ...SPARK_LOOK,
    }),
  }, { transport: { span: '4s' } });
  const call = particlesCall({ doc: writeJson(dir(), 'shot.json', doc), t: randomFlicks(4499, 100, 0, 3) });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop', ...(planted ? { planted } : {}) });
  const r = reading(passed(reply!, call, 'the shot'), 'shot', 'the shot');
  const out: string[] = [];
  for (const s of r.at) {
    const t = secondsOf(s.t);
    const e = 1 - Math.exp(-2 * t);
    const want = [2 * e, 5.4525 * e - 4.905 * t, 0];
    const got = s.cpu[0] ?? null;
    if (got === null || got.some((x, k) => Math.abs(x - want[k]!) > 1e-9)) out.push(`the shot at t = ${fmt(t, 9)} s is at ${fmtV(got, 12)} on the CPU; the closed form puts it at ${fmtV(want, 12)}`);
  }
  return out;
}

function turbulenceProblems(planted?: Planted): string[] {
  const times = randomFlicks(4500, 50, 0, 4);
  const docs = {
    none: smokeDoc(null, 'Smoke none'), zero: smokeDoc({ strength: 0, seed: 1 }, 'Smoke zero'), one: smokeDoc({ strength: 0.3, seed: 1 }, 'Smoke one'),
    two: smokeDoc({ strength: 0.6, seed: 1 }, 'Smoke two'), other: smokeDoc({ strength: 0.3, seed: 2 }, 'Smoke other'),
  };
  const names = Object.keys(docs) as (keyof typeof docs)[];
  const calls = names.map((n) => particlesCall({ doc: writeJson(dir(), `smoke-${n}.json`, docs[n]), t: times }));
  const replies = runGpu(bins.bin('deep-gpu'), dir(), calls, { backend: 'noop', ...(planted ? { planted } : {}) });
  const r = Object.fromEntries(names.map((n, i) => [n, reading(passed(replies[i]!, calls[i]!, `smoke ${n}`), 'smoke', `smoke ${n}`)])) as Record<keyof typeof docs, Reading>;
  const out: string[] = [];
  let largest = 0;
  r.none.at.forEach((s, k) => {
    const t = fmt(secondsOf(s.t), 6);
    s.cpu.forEach((free, row) => {
      const zero = r.zero.at[k]!.cpu[row] ?? null; const one = r.one.at[k]!.cpu[row] ?? null; const two = r.two.at[k]!.cpu[row] ?? null;
      if (JSON.stringify(zero) !== JSON.stringify(free)) out.push(`particle row ${row} at t = ${t} s: strength 0 places it at ${fmtV(zero, 12)}, no turbulence at ${fmtV(free, 12)}`);
      if (free === null || one === null || two === null) {
        if (!(free === null && one === null && two === null)) out.push(`particle row ${row} at t = ${t} s is live with some strengths and not others`);
        return;
      }
      for (let a = 0; a < 3; a++) {
        const d1 = one[a]! - free[a]!; const d2 = two[a]! - free[a]!;
        largest = Math.max(largest, Math.abs(d1));
        if (Math.abs(d2 - 2 * d1) > 1e-9) { out.push(`particle row ${row} at t = ${t} s: its offset at strength 0.6 is ${fmtV(two.map((x, i) => x - free[i]!) as number[], 12)}, not twice its offset at 0.3, ${fmtV(one.map((x, i) => 2 * (x - free[i]!)) as number[], 12)}`); break; }
      }
    });
  });
  if (largest <= 1e-3) out.push(`turbulence of strength 0.3 m moves no particle more than 1 mm from its turbulence-free position (largest offset ${largest} m)`);
  const [t1, t2] = [r.one.turbulence?.table, r.other.turbulence?.table];
  if (!t1 || !t2) out.push(`the readings report no turbulence table (seed 1 ${String(t1)}, seed 2 ${String(t2)})`);
  else if (t1 === t2) out.push(`seeds 1 and 2 give the same table, ${t1}`);
  return out;
}

describe(`${ac(9)} drag and gravity in closed form on the CPU, and turbulence that scales, vanishes and differs by seed`, () => {
  it(`${ac(9)} (drag) a particle launched at (4, 6, 0) m/s with drag 2/s is at x = 2(1 − e^(−2t)), y = 5.4525(1 − e^(−2t)) − 4.905t at 100 random times within 1e-9 m on the CPU`, () => {
    none(shotProblems(), 'the shot against its closed form');
  }, TIMEOUT);

  it(`${ac(9)} (drag, planted) a form that integrates drag by Euler at 1/120 s fails`, () => {
    failsNaming(shotProblems('drag_euler_120'), ['the shot at t = '], 'the planted drag_euler_120');
  }, TIMEOUT);

  it(`${ac(9)} (turbulence) doubling strength doubles every offset within 1e-9, strength 0 equals none bit for bit, and seeds 1 and 2 give different tables`, () => {
    none(turbulenceProblems(), 'turbulence against its scaling');
  }, TIMEOUT);

  it(`${ac(9)} (turbulence, planted) a table of zeros fails`, () => {
    const fails = turbulenceProblems('turbulence_table_zeros');
    expect(fails.length, 'the planted turbulence_table_zeros fails the turbulence check').toBeGreaterThan(0);
  }, TIMEOUT);
});

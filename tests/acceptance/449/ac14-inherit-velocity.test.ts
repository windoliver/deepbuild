// AC14: "On a turntable turning at 1 rad/s, particles born 1 m from the axis with `inherit.velocity: 1` start at
// 1.000 m/s within 0.001 along the tangent; a planted velocity taken from the previous frame's position differs
// between a seek and a play and fails"
//
// The turntable (helpers.ts: turntableDoc): a band 1 m from the Y axis turned by a channel at 1 rad/s about +Y, whose
// surface the item `sparks` names, bursting 128 particles at each of 0.5, 1, 1.5 and 2 s with `inherit.velocity: 1` and
// no velocity of their own, gravity or drag. A point p on it moves at (0, 1, 0) × p = (p.z, 0, −p.x) m/s (Units and
// axes: right-handed, R = Rz·Ry·Rx). The `particles` call reads each particle's birth time, birth point and launch
// velocity, and its CPU f64 position 0.25 s after its burst. Each particle must be born within 1e-4 m of 1 m from the
// axis, and both its reported launch velocity and the velocity its positions give, (position − birth point) ÷ 0.25 s,
// must be 1.000 m/s within 0.001 and within 0.001 m/s of (p.z, 0, −p.x) at its birth point p. Seeking: `view3d` plays
// frames 0 to 75 at 30 fps in one process, and fresh processes opened at frames 20, 40, 55 and 70 draw one frame each;
// each sought frame's pixel hash and evaluated-data hash equal the played one's. The planted `inherit_previous_frame`
// (README: Criteria 12 to 16) differs between a seek and a play, and fails naming the frame where it does.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, TURN, acSurface, failsNaming, flicks, fmt, fmtV, framesOf, none, norm, particlesCall, passed, reading, requireGpu, runGpu,
  runGpuSurface, scale, secondsOf, sub, turntableDoc, useBins, useDir, view3d, writeJson, type SurfacePlanted, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
/** A quarter second after each burst, every particle of it still live (life 1.5 s). */
const READ = TURN.bursts.map((t) => flicks(t + 0.25));
const FPS = 30;
const PLAYED = 75;
const SOUGHT = [20, 40, 55, 70];

/** Each particle's start against the turntable's tangent at its birth point; each failure names the particle. */
function velocityProblems(): string[] {
  const call = particlesCall({ doc: writeJson(dir(), 'turntable.json', turntableDoc()), t: READ });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop' });
  const r = reading(passed(reply!, call, 'the turntable'), 'sparks', 'the turntable');
  expect(r.particles.length, 'the turntable\'s item lists its four bursts of 128').toBe(TURN.bursts.length * TURN.each);
  const out: string[] = [];
  for (const p of r.particles) {
    const name = `particle row ${p.row} (born at ${fmt(p.born, 6)} s at ${fmtV(p.from, 6)})`;
    const k = TURN.bursts.findIndex((t) => Math.abs(p.born - t) <= 1e-9);
    if (k < 0) { out.push(`${name}: born in none of the bursts at 0.5, 1, 1.5 and 2 s`); continue; }
    const radius = Math.hypot(p.from[0], p.from[2]);
    if (Math.abs(radius - TURN.r) > 1e-4) out.push(`${name}: born ${fmt(radius, 6)} m from the axis, not 1 m`);
    const tangent: V3 = [p.from[2], 0, -p.from[0]];
    const at = r.at[k]!.cpu[p.row] ?? null;
    const age = secondsOf(READ[k]!) - p.born;
    const moved: V3 | null = at === null ? null : scale(sub(at, p.from), 1 / age);
    for (const [how, v] of [['launches at (its reported velocity)', p.velocity], ['moves at (from its positions)', moved]] as const) {
      if (v === null) { out.push(`${name}: not live ${fmt(age, 3)} s after its birth`); continue; }
      if (Math.abs(norm(v) - 1) > 1e-3 || norm(sub(v, tangent)) > 1e-3) {
        out.push(`${name}: ${how} ${fmtV(v, 6)} m/s, ${fmt(norm(v), 6)} m/s, not 1.000 m/s within 0.001 along the tangent ${fmtV(tangent, 6)}`);
      }
    }
  }
  return out;
}

/** The turntable sought against played, by pixel hash and evaluated-data hash; each failure names the frame and says seeking. */
function seekProblems(planted?: SurfacePlanted): string[] {
  const doc = writeJson(dir(), 'turntable.json', turntableDoc());
  const bin = bins.bin('deep-gpu');
  const run = (from: number, frames: number) => runGpuSurface(bin, dir(), [view3d({ doc, fps: FPS, from, frames, particles: ['sparks'] })], planted ? { planted } : {});
  const played = new Map(framesOf(run(0, PLAYED + 1)[0]!, 'the turntable, played', ['sparks']).map((f) => [f.frame, f]));
  expect([...played.keys()], 'the played run holds frames 0 to 75').toEqual(Array.from({ length: PLAYED + 1 }, (_, n) => n));
  for (const n of SOUGHT) {
    expect(played.get(n)!.pixelHash, `frame ${n} has a pixel hash`).not.toBeNull();
    expect(played.get(n)!.particles.get('sparks')!.live, `frame ${n}: sparks are live`).toBeGreaterThan(0);
  }
  expect(new Set(SOUGHT.map((n) => played.get(n)!.particles.get('sparks')!.hash)).size, 'the four frames\' evaluated data differ (the sparks fly)').toBe(SOUGHT.length);
  const out: string[] = [];
  for (const n of SOUGHT) {
    const sought = framesOf(run(n, 1)[0]!, `the turntable, sought to frame ${n}`, ['sparks']).find((f) => f.frame === n);
    const want = played.get(n)!;
    if (sought?.pixelHash !== want.pixelHash) out.push(`frame ${n}: seeking gives pixel hash ${sought?.pixelHash?.slice(0, 12)}, playing ${want.pixelHash?.slice(0, 12)}`);
    const a = sought?.particles.get('sparks')?.hash; const b = want.particles.get('sparks')!.hash;
    if (a !== b) out.push(`frame ${n}: seeking gives evaluated-data hash ${a?.slice(0, 12)}, playing ${b.slice(0, 12)}`);
  }
  return out;
}

describe(`${acSurface(14)} particles born on a turntable inherit its velocity at their birth point`, () => {
  it(`${acSurface(14)} (velocity) particles born 1 m from the axis of a turntable turning at 1 rad/s, with inherit.velocity 1, start at 1.000 m/s within 0.001 along the tangent`, () => {
    none(velocityProblems(), 'the turntable\'s sparks against the tangent');
  }, TIMEOUT);

  it(`${acSurface(14)} (seek) seeking the turntable to frames 20, 40, 55 and 70 equals playing to them, by pixel hash and evaluated-data hash`, () => {
    requireGpu();
    none(seekProblems(), 'the turntable sought against played');
  }, TIMEOUT);

  it(`${acSurface(14)} (planted) a velocity taken from the previous frame's position differs between a seek and a play and fails`, () => {
    requireGpu();
    failsNaming(seekProblems('inherit_previous_frame'), ['seeking gives'], 'the planted inherit_previous_frame');
  }, TIMEOUT);
});

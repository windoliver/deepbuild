// AC7: "Particles land on a height map: 4,096 particles born over 0 to 1 s at y = 5 m across a 2 × 2 m square, falling
// under gravity 9.81 m/s² with no drag onto `land: {on: a collection of a 1 m cube resting on a 4 × 4 m floor at y = 0
// under the square's centre, cell: 0.05 m, then: rest}`, rest at y = 1 m within 1e-4 m where they fall more than two
// cells inside the cube's top, √(8 ÷ 9.81) ≈ 0.9031 s after birth, and at y = 0 more than two cells outside it,
// √(10 ÷ 9.81) ≈ 1.0096 s after birth, each within 1e-4 s; seeking equals playing by evaluated-data hash; with
// `then: bounce` and restitution 0.5, a particle that lands on the cube's top rises to y = 2 m within 1e-3 m, 0.5² of
// its 4 m fall; a planted landing against the floor's plane alone rests the cube-top particles at y = 0 and fails,
// naming a particle; and a cube that a channel moves is refused at check, naming it"
//
// The landing fixture (helpers.ts: landingDoc). For every particle the `particles` call lists (its birth time and
// point, its first hit), one more than two cells (0.1 m) inside the cube's top in x and z must first meet the map
// √(8 ÷ 9.81) s after birth and one more than two cells outside it √(10 ÷ 9.81) s after, each within 1e-4 s, and at
// 2.5 s (every particle born, landed and still alive) it must rest at y = 1 or y = 0 within 1e-4 m. Seeking: `view3d`
// with this suite's `particles` field plays frames 0 to 150 at 60 fps in one process, and fresh processes opened at
// frames 37, 61, 100 and 150 (#380's `from`) draw one frame each; each sought frame's evaluated-data hash equals the
// played one's, the four differ, and the hash at frame 61 is the SHA-256 this suite defines over the `particles`
// call's CPU positions at that frame's time. With `then: bounce` (restitution 0.5), eight cube-top particles each sit at
// y = 2 within 1e-3 m at their apex, 0.5 × 9.81 × √(8 ÷ 9.81) ÷ 9.81 s after landing. The moving cube's document is
// refused at check, naming cube. The planted `land_floor_plane_only` (README: Planted programs) fails the rest check,
// naming a particle.

import { describe, expect, it } from 'vitest';
import {
  RAIN, TIMEOUT, ac, checkOf, evaluatedHash, failsNaming, flicks, fmt, fmtV, framesOf, frameFlicks, landingDoc, none, particlesCall,
  passed, reading, refusalsNaming, requireGpu, runGpu, show, useBins, useDir, view3d, writeJson, type Planted, type Reading,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const G = 9.81;
const CUBE_TOP = Math.sqrt(8 / G);
const FLOOR = Math.sqrt(10 / G);
const MARGIN = 2 * RAIN.cell;
const SETTLED = flicks(2.5);
const FPS = 60;
const PLAYED = 150;
const SOUGHT = [37, 61, 100, 150];

/** Which side of the cube's top edge a particle falls on: more than two cells inside, outside, or near the edge. */
function where(x: number, z: number): 'top' | 'floor' | 'edge' {
  const half = RAIN.cube / 2;
  const m = Math.max(Math.abs(x), Math.abs(z));
  return m < half - MARGIN ? 'top' : m > half + MARGIN ? 'floor' : 'edge';
}

function rain(planted?: Planted): Reading {
  const call = particlesCall({ doc: writeJson(dir(), 'landing.json', landingDoc('rest')), t: [SETTLED] });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop', ...(planted ? { planted } : {}) });
  return reading(passed(reply!, call, 'the landing'), 'rain', 'the landing');
}

/** Every particle's landing time and resting height against the issue's; each failure names the particle. */
function landingProblems(r: Reading): string[] {
  const out: string[] = [];
  if (r.particles.length !== RAIN.count) out.push(`the rain lists ${r.particles.length} particles born, not ${RAIN.count}`);
  const counts = { top: 0, floor: 0, edge: 0 };
  for (const p of r.particles) {
    const side = where(p.from[0], p.from[2]);
    counts[side]++;
    if (side === 'edge') continue;
    const name = `particle row ${p.row} (born at ${fmt(p.born, 4)} s at ${fmtV(p.from, 3)}, ${side === 'top' ? 'over the cube\'s top' : 'over the floor'})`;
    const fall = side === 'top' ? CUBE_TOP : FLOOR;
    const first = p.hits[0];
    if (!first || Math.abs(first.t - p.born - fall) > 1e-4) out.push(`${name}: first lands ${first ? fmt(first.t - p.born, 6) : 'never'} s after birth, not ${fmt(fall, 6)} s`);
    const at = r.at[0]!.cpu[p.row] ?? null;
    const y = side === 'top' ? 1 : 0;
    if (at === null || Math.abs(at[1] - y) > 1e-4) out.push(`${name}: at 2.5 s rests at ${fmtV(at, 6)}, not at y = ${y} m`);
  }
  if (counts.top < 400 || counts.floor < 2000) out.push(`the rain's square holds ${counts.top} particles over the cube's top and ${counts.floor} over the floor, too few to judge`);
  return out;
}

describe(`${ac(7)} particles land on a height map`, () => {
  it(`${ac(7)} (rest) 4,096 particles land on the cube's top √(8 ÷ 9.81) s after birth and rest at y = 1 m, or on the floor √(10 ÷ 9.81) s after and rest at y = 0`, () => {
    none(landingProblems(rain()), 'the rain on the cube and the floor');
  }, TIMEOUT);

  it(`${ac(7)} (seek) seeking to frames 37, 61, 100 and 150 equals playing to them by evaluated-data hash`, () => {
    requireGpu();
    const doc = writeJson(dir(), 'landing.json', landingDoc('rest'));
    const bin = bins.bin('deep-gpu');
    const [playedReply] = runGpu(bin, dir(), [view3d({ doc, fps: FPS, from: 0, frames: PLAYED + 1, particles: ['rain'] })]);
    const played = new Map(framesOf(playedReply!, 'the landing, played', ['rain']).map((f) => [f.frame, f.particles.get('rain')!.hash]));
    expect([...played.keys()], 'the played run holds frames 0 to 150').toEqual(Array.from({ length: PLAYED + 1 }, (_, n) => n));
    expect(new Set(SOUGHT.map((n) => played.get(n))).size, 'the four frames\' evaluated data differ (the rain moves)').toBe(SOUGHT.length);
    const fails: string[] = [];
    for (const n of SOUGHT) {
      const [r] = runGpu(bin, dir(), [view3d({ doc, fps: FPS, from: n, frames: 1, particles: ['rain'] })]);
      const sought = framesOf(r!, `the landing, sought to frame ${n}`, ['rain']).find((f) => f.frame === n)?.particles.get('rain')?.hash;
      if (sought !== played.get(n)) fails.push(`frame ${n}: seeking gives evaluated-data hash ${sought?.slice(0, 12)}, playing ${played.get(n)?.slice(0, 12)}`);
    }
    none(fails, 'seek against play');
    const call = particlesCall({ doc, t: [frameFlicks(61, FPS)] });
    const [cpu] = runGpu(bin, dir(), [call], { backend: 'noop' });
    const at61 = reading(passed(cpu!, call, 'the landing at frame 61'), 'rain', 'the landing at frame 61').at[0]!.cpu;
    expect(played.get(61), 'frame 61\'s hash is the SHA-256 of the CPU f64 evaluation at its time (README: view3d\'s particles)').toBe(evaluatedHash(at61));
  }, TIMEOUT);

  it(`${ac(7)} (bounce) with then: bounce and restitution 0.5, a particle landing on the cube's top rises to y = 2 m within 1e-3 m`, () => {
    const doc = writeJson(dir(), 'landing-bounce.json', landingDoc('bounce'));
    const first = particlesCall({ doc, t: [SETTLED] });
    const bin = bins.bin('deep-gpu');
    const [listed] = runGpu(bin, dir(), [first], { backend: 'noop' });
    const tops = reading(passed(listed!, first, 'the bouncing landing'), 'rain', 'the bouncing landing').particles.filter((p) => where(p.from[0], p.from[2]) === 'top');
    expect(tops.length, 'particles fall over the cube\'s top').toBeGreaterThan(8);
    const chosen = tops.filter((_, i) => i % Math.floor(tops.length / 8) === 0).slice(0, 8);
    const rise = (0.5 * G * CUBE_TOP) / G;
    const apex = (born: number): number => born + CUBE_TOP + rise;
    const call = particlesCall({ doc, t: chosen.map((p) => flicks(apex(p.born))) });
    const [reply] = runGpu(bin, dir(), [call], { backend: 'noop' });
    const r = reading(passed(reply!, call, 'the bouncing landing at the apexes'), 'rain', 'the bouncing landing at the apexes');
    const fails: string[] = [];
    chosen.forEach((p, k) => {
      const at = r.at[k]!.cpu[p.row] ?? null;
      if (at === null || Math.abs(at[1] - 2) > 1e-3) fails.push(`particle row ${p.row}: at its apex, ${fmt(apex(p.born), 6)} s, it is at ${fmtV(at, 6)}, not at y = 2 m`);
    });
    none(fails, 'cube-top particles rising after their bounce');
  }, TIMEOUT);

  it(`${ac(7)} (moving receiver) a cube that a channel moves is refused at check, naming it`, () => {
    const call = particlesCall({ doc: writeJson(dir(), 'landing-moving.json', landingDoc('moving')) });
    const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop' });
    const c = checkOf(reply!, call, 'the moving cube');
    expect(c.outcome, `land on a cube a channel moves is refused at check: ${show(c.raw)}`).toBe('refused');
    expect(refusalsNaming(c, 'cube').length, `an error issue names cube: ${show(c.issues.map((i) => i.raw))}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ac(7)} (planted) a landing against the floor's plane alone rests the cube-top particles at y = 0 and fails, naming a particle`, () => {
    failsNaming(landingProblems(rain('land_floor_plane_only')), ['particle row'], 'the planted land_floor_plane_only');
  }, TIMEOUT);
});

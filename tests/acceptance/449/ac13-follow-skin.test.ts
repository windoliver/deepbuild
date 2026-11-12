// AC13: "On a skinned character walking in place, 4,096 particles with `follow` on stay within 0.1 mm of their
// triangles at 50 sampled times, with the same pixel hash by seeking and by playing; a planted emitter that reads the
// bind pose leaves them behind and fails, naming the particle"
//
// The walker (helpers.ts: walkerDoc): a `fixture.skin@1` of seven bones walking in place over 2 s, its knees blended
// half and half, whose surface the item `dust` names with `follow: true`, bursting 4,096 particles at 0.1 s. The
// `particles` call reads each particle's birth time and point and its CPU f64 position at 50 random times in
// (0.1, 2) s. The test skins the walker itself, by the formula #419's README gives `fixture.skin@1`, at each particle's
// birth time and at each sampled time. A particle's triangles are those its birth point lies within 0.1 mm of at its
// birth time (one, or a few where it was born on an edge); it passes when it lies within 0.1 mm of one of them at every
// sampled time. Seeking: `view3d` plays frames 0 to 60 at 30 fps in one process, and fresh processes opened at frames 7,
// 23, 41 and 58 draw one frame each; each sought frame's pixel hash equals the played one's, and the four differ. The
// planted `surface_bind_pose` (README: Criteria 12 to 16) fails the first check, naming the particle.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, WALKER, acSurface, failsNaming, fmt, fmtV, framesOf, none, particlesCall, passed, randomFlicks, reading, requireGpu, runGpu,
  runGpuSurface, secondsOf, triangleDistance, useBins, useDir, view3d, walkerAt, walkerDoc, walkerSkin, writeJson,
  type SurfacePlanted, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const COUNT = 4096;
/** "Within 0.1 mm". */
const NEAR = 1e-4;
const TIMES = randomFlicks(4513, 50, WALKER.burst, WALKER.span);
const FPS = 30;
const PLAYED = 60;
const SOUGHT = [7, 23, 41, 58];

/** Every particle against its triangles at its birth and at the 50 times; each failure names the particle. */
function followProblems(planted?: SurfacePlanted): string[] {
  const call = particlesCall({ doc: writeJson(dir(), 'walker.json', walkerDoc(COUNT)), t: TIMES });
  const [reply] = runGpuSurface(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop', ...(planted ? { planted } : {}) });
  const r = reading(passed(reply!, call, 'the walker'), 'dust', 'the walker');
  expect(r.particles.length, 'the walker\'s item lists the 4,096 particles of its burst').toBe(COUNT);
  const triangles = walkerSkin().triangles;
  const poses = new Map<number, V3[]>();
  const pose = (s: number): V3[] => {
    if (!poses.has(s)) poses.set(s, walkerAt(s));
    return poses.get(s)!;
  };
  const distance = (p: V3, k: number, at: V3[]): number => {
    const [a, b, c] = triangles[k]!;
    return triangleDistance(p, at[a]!, at[b]!, at[c]!);
  };
  const out: string[] = [];
  for (const p of r.particles) {
    const name = `particle row ${p.row} (born at ${fmt(p.born, 6)} s at ${fmtV(p.from, 6)})`;
    if (Math.abs(p.born - WALKER.burst) > 1e-9) { out.push(`${name}: not born in the burst at 0.1 s`); continue; }
    const birth = pose(p.born);
    const gaps = triangles.map((_, k) => distance(p.from, k, birth));
    const own = gaps.flatMap((d, k) => (d <= NEAR ? [k] : []));
    if (!own.length) { out.push(`${name}: its birth point lies ${fmt(Math.min(...gaps), 6)} m from the walker's surface at its birth time, on no triangle within 0.1 mm`); continue; }
    let best = { k: -1, worst: Infinity, t: 0, at: null as V3 | null };
    for (const k of own) {
      let worst = { d: 0, t: 0, at: null as V3 | null };
      for (const s of r.at) {
        const q = s.cpu[p.row] ?? null;
        const d = q === null ? Infinity : distance(q, k, pose(secondsOf(s.t)));
        if (d > worst.d) worst = { d, t: s.t, at: q };
      }
      if (worst.d <= best.worst) best = { k, worst: worst.d, t: worst.t, at: worst.at };
    }
    if (best.worst > NEAR) {
      out.push(`${name}: at t = ${fmt(secondsOf(best.t), 6)} s it ${best.at ? `lies at ${fmtV(best.at, 6)}, ${fmt(best.worst, 6)} m from its triangle ${best.k}` : 'is not live'}, past 0.1 mm`);
    }
  }
  return out;
}

describe(`${acSurface(13)} particles that follow a skinned character stay on their triangles, and seeking draws what playing does`, () => {
  it(`${acSurface(13)} (follow) on the walker, 4,096 particles with follow on stay within 0.1 mm of their triangles at 50 sampled times`, () => {
    none(followProblems(), 'the walker\'s particles against their triangles');
  }, TIMEOUT);

  it(`${acSurface(13)} (seek) seeking the walker to frames 7, 23, 41 and 58 gives the pixel hash playing to them does`, () => {
    requireGpu();
    const doc = writeJson(dir(), 'walker.json', walkerDoc(COUNT));
    const bin = bins.bin('deep-gpu');
    const [playedReply] = runGpu(bin, dir(), [view3d({ doc, fps: FPS, from: 0, frames: PLAYED + 1, particles: ['dust'] })]);
    const played = new Map(framesOf(playedReply!, 'the walker, played', ['dust']).map((f) => [f.frame, f]));
    expect([...played.keys()], 'the played run holds frames 0 to 60').toEqual(Array.from({ length: PLAYED + 1 }, (_, n) => n));
    for (const n of SOUGHT) {
      expect(played.get(n)!.pixelHash, `frame ${n} has a pixel hash`).not.toBeNull();
      expect(played.get(n)!.particles.get('dust')!.live, `frame ${n}: the 4,096 particles are live`).toBe(COUNT);
    }
    expect(new Set(SOUGHT.map((n) => played.get(n)!.pixelHash)).size, 'the four frames\' pixels differ (the walker walks)').toBe(SOUGHT.length);
    const fails: string[] = [];
    for (const n of SOUGHT) {
      const [r] = runGpu(bin, dir(), [view3d({ doc, fps: FPS, from: n, frames: 1, particles: ['dust'] })]);
      const sought = framesOf(r!, `the walker, sought to frame ${n}`, ['dust']).find((f) => f.frame === n)?.pixelHash;
      if (sought !== played.get(n)!.pixelHash) fails.push(`frame ${n}: seeking gives pixel hash ${sought?.slice(0, 12)}, playing ${played.get(n)!.pixelHash?.slice(0, 12)}`);
    }
    none(fails, 'the walker sought against played');
  }, TIMEOUT);

  it(`${acSurface(13)} (planted) an emitter that reads the bind pose leaves the particles behind and fails, naming the particle`, () => {
    failsNaming(followProblems('surface_bind_pose'), ['particle row'], 'the planted surface_bind_pose');
  }, TIMEOUT);
});

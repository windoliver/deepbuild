// AC4: "A whole trail of a point on a rolling wheel over 4 s at 60 Hz holds a sample every 1/60 s, each within 1e-9 of
// r(θ − sin θ, 1 − cos θ); at t = 1.37 s it draws the samples at k ÷ 60 s for k = 0 to 82 and a last segment ending
// exactly at the point; seeked equals played by evaluated-data hash; 24 and 60 fps give identical polylines; and a
// planted trail that appends a point per drawn frame differs between 24 and 60 fps and fails"
//
// The rolling wheel (helpers.ts: wheelDoc('whole')): r = 0.5 m, θ = π t, the rim's trail with
// `window: {whole: {from: "0s"}}`, `rate: 60`, over a 4 s transport.
// - The `trail` call's bake: a sample at each k ÷ 60 s from 0 (k × 11,760,000 flicks) through the transport's end,
//   each within 1e-9 m on every axis of r(θ − sin θ, 1 − cos θ, 0).
// - `view3d` at 100 fps, frame 137 (1.37 s exactly): one trace of 84 points, points 0 to 82 the bake's samples k = 0
//   to 82 bit for bit, and point 83 the reported source, bit for bit, which is the rim at 1.37 s within 1e-9 m.
// - Frames 0 to 240 played at 60 fps in one process, frames 30, 82, 137 and 200 each sought in a fresh one: equal trail
//   hashes, each the SHA-256 of its points; the four differ.
// - Frames played at 24 fps (0 to 96) and at 60 fps (0 to 240): at every shared time m ÷ 12 s, m = 0 to 48, the same
//   polyline bit for bit; at 3.5 s it holds at least 210 points.
// - The planted `trail_appends_per_frame` (README: Planted programs) fails that comparison, naming the time.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, STEP_60, TIMEOUT, ac, axisGap, bakesOf, cycloid, failsNaming, fmt, fmtV, frameFlicks, none, requireGpu, run,
  trailAt, trailFrames, trailHash, useBins, useDir, view3d, wheelDoc, writeJson, type Planted, type TrailReport, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [160, 120];
const doc = (): string => writeJson(dir(), 'wheel-whole.json', wheelDoc('whole'));

/** Each played run's trail reports by frame, kept per frame rate and plant so the files' tests share them. */
const runs = new Map<string, Map<number, TrailReport>>();
function played(fps: number, frames: number, planted?: Planted): Map<number, TrailReport> {
  const key = `${fps}:${planted ?? ''}`;
  if (!runs.has(key)) {
    const [reply] = run(bins.bin('deep-gpu'), dir(), [view3d({ doc: doc(), size: SIZE, fps, from: 0, frames, trails: ['trail'] })], planted ? { planted } : {});
    const out = new Map(trailFrames(reply!, `the wheel at ${fps} fps${planted ? `, planted ${planted}` : ''}`, ['trail']).map((f) => [f.frame, trailAt(f, 'trail')]));
    expect([...out.keys()], `the ${fps} fps run holds frames 0 to ${frames - 1}`).toEqual(Array.from({ length: frames }, (_, n) => n));
    runs.set(key, out);
  }
  return runs.get(key)!;
}
const polyline = (r: TrailReport | undefined): V3[] => (r ? r.traces.flatMap((t) => t.points) : []);

/** The polylines at 24 and 60 fps at each shared time; each failure names the time. */
function fpsProblems(at24: Map<number, TrailReport>, at60: Map<number, TrailReport>): string[] {
  const out: string[] = [];
  for (let m = 0; m <= 48; m++) {
    const a = polyline(at24.get(2 * m)); const b = polyline(at60.get(5 * m));
    const when = `t = ${fmt(m / 12, 4)} s (frame ${2 * m} at 24 fps, ${5 * m} at 60 fps)`;
    const i = a.findIndex((p, k) => !b[k] || p.some((x, j) => !Object.is(x, b[k]![j])));
    if (a.length !== b.length || i >= 0) out.push(`${when}: at 24 fps the polyline holds ${a.length} points, at 60 fps ${b.length}${i >= 0 ? `; point ${i} is ${fmtV(a[i]!, 9)} at 24 fps and ${fmtV(b[i] ?? null, 9)} at 60 fps` : ''}`);
    if (m === 42 && (a.length < 210 || b.length < 210)) out.push(`${when}: the whole trail holds ${a.length} and ${b.length} points, not the 210 samples before 3.5 s and more`);
  }
  return out;
}

describe(`${ac(4)} a whole trail of a point on a rolling wheel, baked at 60 Hz`, () => {
  it(`${ac(4)} (bake) the bake holds a sample every 1/60 s over the 4 s, each within 1e-9 m of r(θ − sin θ, 1 − cos θ)`, () => {
    const [reply] = run(bins.bin('deep-gpu'), dir(), [{ call: 'trail', doc: doc() }], { backend: 'noop' });
    const bake = bakesOf(reply!, 'the whole trail').get('trail');
    expect(bake?.window, 'the trail call reads the line trail\'s whole window').toBe('whole');
    const samples = bake!.samples;
    expect(samples, 'the whole trail has its bake\'s samples').not.toBeNull();
    expect([240, 241], `the bake holds the samples from 0 through the transport's 4 s, got ${samples!.length}`).toContain(samples!.length);
    const fails: string[] = [];
    samples!.forEach((s, k) => {
      if (s.t !== k * STEP_60) fails.push(`sample ${k} is at ${s.t} flicks (${fmt(s.t / FLICKS, 9)} s), not ${k} ÷ 60 s`);
      const want = cycloid((k * STEP_60) / FLICKS);
      if (axisGap(s.at, want) > 1e-9) fails.push(`sample ${k} (${fmt(k / 60, 6)} s) is ${fmtV(s.at, 12)}, the rim is at ${fmtV(want, 12)}, ${axisGap(s.at, want).toExponential(2)} m apart`);
    });
    none(fails, 'the bake\'s samples against the cycloid');
  }, TIMEOUT);

  it(`${ac(4)} (1.37 s) at t = 1.37 s it draws the samples at k ÷ 60 s for k = 0 to 82 and a last segment ending exactly at the point`, () => {
    requireGpu();
    const bin = bins.bin('deep-gpu');
    const d = doc();
    const [bakeReply] = run(bin, dir(), [{ call: 'trail', doc: d }], { backend: 'noop' });
    const samples = bakesOf(bakeReply!, 'the whole trail').get('trail')?.samples ?? [];
    expect(samples.length, 'the bake holds at least 83 samples').toBeGreaterThan(82);
    expect(frameFlicks(137, 100), 'frame 137 at 100 fps is 1.37 s').toBe(966_672_000);
    const [reply] = run(bin, dir(), [view3d({ doc: d, size: SIZE, fps: 100, from: 137, frames: 1, trails: ['trail'] })]);
    const f = trailFrames(reply!, 'the wheel at 1.37 s', ['trail']).find((x) => x.frame === 137);
    expect(f, 'the reply holds frame 137').toBeDefined();
    const r = trailAt(f!, 'trail');
    expect(r.traces.length, 'a whole trail draws one trace').toBe(1);
    const pts = r.traces[0]!.points;
    expect(pts.length, 'the trace holds the 83 samples before 1.37 s and the point at 1.37 s').toBe(84);
    const fails: string[] = [];
    for (let k = 0; k <= 82; k++) {
      if (!pts[k]!.every((x, j) => Object.is(x, samples[k]!.at[j]))) fails.push(`point ${k} is ${fmtV(pts[k]!, 12)}, not the bake's sample at ${k} ÷ 60 s, ${fmtV(samples[k]!.at, 12)}`);
    }
    if (!pts[83]!.every((x, j) => Object.is(x, r.source[j]))) fails.push(`the last segment ends at ${fmtV(pts[83]!, 12)}, not at the point, ${fmtV(r.source, 12)}`);
    const want = cycloid(1.37);
    if (axisGap(r.source, want) > 1e-9) fails.push(`the point at 1.37 s is reported at ${fmtV(r.source, 12)}, the rim is at ${fmtV(want, 12)}`);
    none(fails, 'the trail at 1.37 s');
  }, TIMEOUT);

  it(`${ac(4)} (seek) frames 30, 82, 137 and 200, each sought in a fresh process, have the played frames' evaluated-data hashes`, () => {
    requireGpu();
    const SOUGHT = [30, 82, 137, 200];
    const at60 = played(60, 241);
    const fails: string[] = [];
    for (const n of SOUGHT) {
      const p = at60.get(n)!;
      if (polyline(p).length < 2) fails.push(`frame ${n}: the played trail holds ${polyline(p).length} points`);
      if (p.hash !== trailHash(p.traces)) fails.push(`frame ${n}: the reported hash ${p.hash.slice(0, 12)} isn't the SHA-256 of its points (README: view3d's trails)`);
    }
    none(fails, 'the played trail');
    expect(new Set(SOUGHT.map((n) => at60.get(n)!.hash)).size, 'the four frames\' trails differ (the trail grows)').toBe(SOUGHT.length);
    const seek: string[] = [];
    for (const n of SOUGHT) {
      const [reply] = run(bins.bin('deep-gpu'), dir(), [view3d({ doc: doc(), size: SIZE, fps: 60, from: n, frames: 1, trails: ['trail'] })]);
      const f = trailFrames(reply!, `the wheel, sought to frame ${n}`, ['trail']).find((x) => x.frame === n);
      const h = f ? trailAt(f, 'trail').hash : undefined;
      if (h !== at60.get(n)!.hash) seek.push(`frame ${n}: seeking gives trail hash ${h?.slice(0, 12)}, playing ${at60.get(n)!.hash.slice(0, 12)}`);
    }
    none(seek, 'seek against play');
  }, TIMEOUT);

  it(`${ac(4)} (24 and 60 fps) the polylines at 24 and at 60 fps are identical at every shared time`, () => {
    requireGpu();
    none(fpsProblems(played(24, 97), played(60, 241)), 'the whole trail at 24 against 60 fps');
  }, TIMEOUT);

  it(`${ac(4)} (planted) a trail that appends a point per drawn frame differs between 24 and 60 fps and fails`, () => {
    requireGpu();
    const plant: Planted = 'trail_appends_per_frame';
    failsNaming(fpsProblems(played(24, 97, plant), played(60, 241, plant)), ['t = '], `the planted ${plant}`);
  }, TIMEOUT);
});

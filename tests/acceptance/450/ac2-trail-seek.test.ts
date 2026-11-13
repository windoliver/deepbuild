// AC2: "A trail seeked to any time equals the played one by evaluated-data hash"
//
// The rolling wheel (helpers.ts: wheelDoc('span')): a trail of the point on its rim, whose world position comes through
// its parent's keyed roll and turn, with the default window, the last 0.5 s in 16 segments. `view3d` with this suite's
// `trails` field plays frames 0 to 120 at 30 fps in one process, and fresh processes opened at frames 17, 41, 77 and 113
// (#380's `from`) draw one frame each: each sought frame's trail hash equals the played one's. Guards, at each of those
// frames as played: one trace of 17 points, point i the rim at t − (16 − i) × 0.5 ÷ 16 s, r(θ − sin θ, 1 − cos θ, 0)
// within 1e-6 m (so the trail is the source evaluated again at earlier times, and not empty); the reported hash is the
// SHA-256 this suite defines over those points; and the four hashes differ (the trail moves).

import { describe, expect, it } from 'vitest';
import {
  FLICKS, SPAN, TIMEOUT, ac, axisGap, cycloid, fmt, fmtV, frameFlicks, none, requireGpu, run, trailAt, trailFrames, trailHash,
  useBins, useDir, view3d, wheelDoc, writeJson, type TrailReport,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FPS = 30;
const PLAYED = 120;
const SOUGHT = [17, 41, 77, 113];
const STEP = (SPAN.span * FLICKS) / SPAN.segments;

/** The trail at frame n against the rim's closed form at its earlier times; each failure names the frame. */
function trailProblems(n: number, r: TrailReport): string[] {
  const t = frameFlicks(n, FPS);
  const out: string[] = [];
  if (r.traces.length !== 1) return [`frame ${n}: the span trail draws ${r.traces.length} traces, not one`];
  const pts = r.traces[0]!.points;
  if (pts.length !== SPAN.segments + 1) out.push(`frame ${n}: the trace holds ${pts.length} points, not ${SPAN.segments + 1}`);
  pts.forEach((p, i) => {
    const at = (t - (SPAN.segments - i) * STEP) / FLICKS;
    const want = cycloid(at);
    if (axisGap(p, want) > 1e-6) out.push(`frame ${n}: point ${i} is ${fmtV(p, 9)}, the rim at ${fmt(at, 6)} s is ${fmtV(want, 9)}`);
  });
  if (r.hash !== trailHash(r.traces)) out.push(`frame ${n}: the reported hash ${r.hash.slice(0, 12)} isn't the SHA-256 of its points (README: view3d's trails)`);
  return out;
}

describe(`${ac(2)} a trail sought to any time equals the played one by evaluated-data hash`, () => {
  it(`${ac(2)} the rim's span trail at frames 17, 41, 77 and 113, each sought in a fresh process, has the played frame's hash`, () => {
    requireGpu();
    const doc = writeJson(dir(), 'wheel-span.json', wheelDoc('span'));
    const bin = bins.bin('deep-gpu');
    const [playedReply] = run(bin, dir(), [view3d({ doc, fps: FPS, from: 0, frames: PLAYED + 1, trails: ['trail'] })]);
    const played = new Map(trailFrames(playedReply!, 'the wheel, played', ['trail']).map((f) => [f.frame, trailAt(f, 'trail')]));
    expect([...played.keys()], 'the played run holds frames 0 to 120').toEqual(Array.from({ length: PLAYED + 1 }, (_, n) => n));
    none(SOUGHT.flatMap((n) => trailProblems(n, played.get(n)!)), 'the played trail is the rim evaluated again at earlier times');
    expect(new Set(SOUGHT.map((n) => played.get(n)!.hash)).size, 'the four frames\' trails differ (the wheel rolls)').toBe(SOUGHT.length);

    const seek: string[] = [];
    for (const n of SOUGHT) {
      const [reply] = run(bin, dir(), [view3d({ doc, fps: FPS, from: n, frames: 1, trails: ['trail'] })]);
      const f = trailFrames(reply!, `the wheel, sought to frame ${n}`, ['trail']).find((x) => x.frame === n);
      const sought = f ? trailAt(f, 'trail') : undefined;
      if (sought?.hash !== played.get(n)!.hash) seek.push(`frame ${n}: seeking gives trail hash ${sought?.hash.slice(0, 12)}, playing ${played.get(n)!.hash.slice(0, 12)}`);
    }
    none(seek, 'seek against play');
  }, TIMEOUT);
});

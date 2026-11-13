// AC3: "An item thrown along a closed-form arc at 10 m/s from three cues at 0, 2 and 4 s, at 30°, 45° and 60°, with
// `window: since {on: markers.cue}` and its default keep of 3, draws three traces at t = 6 s, each peaking at
// v² sin²θ ÷ 2g above its start (1.27, 2.55 and 3.82 m within 0.05 m) and ending at the next start; a fourth cue drops
// the 30° trace; and seeking to any time draws the same traces as playing, by pixel hash on one machine"
//
// The thrown ball (helpers.ts: throwDoc): drivers over `markers.cue` throw it at each cue's angle from where it last
// landed, and the line `arcs` trails it with `window: {since: {on: {list: "markers.cue"}}}`, keep unset. `view3d` with
// this suite's `trails` field, at 24 fps:
// - at frame 144 (6 s): three traces, starting at 0, 2 and 4 s at the ball's start of each throw (x = that cue's start,
//   y = 0), each peaking (its highest point less its first point's height) at 1.27, 2.55 and 3.82 m within 0.05 m; the
//   first two end at the next start, 2 and 4 s, their last point within 1e-9 m of the next trace's first; the third
//   ends at t, at the ball;
// - with a fourth cue at 6 s (75°), at frame 180 (7.5 s): three traces, starting at 2, 4 and 6 s; none at 0 s;
// - frames 0 to 144 played in one process and frames 20, 55, 100 and 144 each sought in a fresh one (#380's `from`)
//   have equal pixel hashes. Guards: the four differ; the sought frames draw 1, 2, 3 and 3 traces; and the document
//   without `arcs` draws other pixels at each of them, so the traces are in the pixels compared.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, FOURTH_CUE, THREE_CUES, TIMEOUT, ac, axisGap, fmt, fmtV, frameFlicks, framesOf, none, requireGpu, run, throwDoc, throwStarts,
  trailAt, trailFrames, useBins, useDir, view3d, writeJson, type TrailFrame, type TrailReport,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FPS = 24;
const PEAKS = [1.27, 2.55, 3.82];
const s = (f: number): string => fmt(f / FLICKS, 6);

/** One frame of the thrown ball, sought in a fresh process. */
function sought(doc: string, n: number, what: string): TrailFrame {
  const [reply] = run(bins.bin('deep-gpu'), dir(), [view3d({ doc, fps: FPS, from: n, frames: 1, trails: ['arcs'] })]);
  const f = trailFrames(reply!, `${what}, frame ${n}`, ['arcs']).find((x) => x.frame === n);
  expect(f, `${what}: the reply holds frame ${n}`).toBeDefined();
  return f!;
}

/** The three traces at 6 s against the issue's; each failure names the trace by its cue. */
function sixSecondProblems(r: TrailReport): string[] {
  const out: string[] = [];
  if (r.traces.length !== 3) return [`at 6 s the trail draws ${r.traces.length} traces (starting at ${r.traces.map((t) => s(t.start)).join(', ')} s), not three`];
  const xs = throwStarts(THREE_CUES);
  r.traces.forEach((tr, k) => {
    const cue = THREE_CUES[k]!;
    const name = `the ${cue.angle}° trace (cue at ${cue.t} s)`;
    if (tr.start !== cue.t * FLICKS) out.push(`${name}: starts at ${s(tr.start)} s, not ${cue.t} s`);
    if (tr.points.length < 2) { out.push(`${name}: holds ${tr.points.length} points`); return; }
    const first = tr.points[0]!; const last = tr.points[tr.points.length - 1]!;
    if (axisGap(first, [xs[k]!, 0, 0]) > 1e-9) out.push(`${name}: starts at ${fmtV(first, 9)}, not at the throw's start (${fmt(xs[k]!, 9)}, 0, 0)`);
    const peak = Math.max(...tr.points.map((p) => p[1])) - first[1];
    if (Math.abs(peak - PEAKS[k]!) > 0.05) out.push(`${name}: peaks ${fmt(peak, 4)} m above its start, not ${PEAKS[k]} m within 0.05 m`);
    if (k < 2) {
      const next = r.traces[k + 1];
      if (tr.end !== THREE_CUES[k + 1]!.t * FLICKS) out.push(`${name}: ends at ${s(tr.end)} s, not at the next start, ${THREE_CUES[k + 1]!.t} s`);
      if (next && next.points.length && axisGap(last, next.points[0]!) > 1e-9) out.push(`${name}: ends at ${fmtV(last, 9)}, not at the next start ${fmtV(next.points[0]!, 9)}`);
    } else {
      if (tr.end !== 6 * FLICKS) out.push(`${name}: ends at ${s(tr.end)} s, not at t = 6 s`);
      if (axisGap(last, r.source) > 1e-9) out.push(`${name}: ends at ${fmtV(last, 9)}, not at the ball at 6 s, ${fmtV(r.source, 9)}`);
    }
  });
  return out;
}

describe(`${ac(3)} an item thrown from three cues with window: since {on: markers.cue} draws its last three traces`, () => {
  it(`${ac(3)} at t = 6 s it draws three traces peaking 1.27, 2.55 and 3.82 m above their starts within 0.05 m, each ending at the next start`, () => {
    requireGpu();
    const doc = writeJson(dir(), 'throws.json', throwDoc(THREE_CUES));
    const f = sought(doc, 144, 'the three throws');
    expect(frameFlicks(144, FPS), 'frame 144 at 24 fps is 6 s').toBe(6 * FLICKS);
    none(sixSecondProblems(trailAt(f, 'arcs')), 'the three traces at 6 s');
  }, TIMEOUT);

  it(`${ac(3)} a fourth cue at 6 s drops the 30° trace: at 7.5 s the traces start at 2, 4 and 6 s`, () => {
    requireGpu();
    const doc = writeJson(dir(), 'four-throws.json', throwDoc([...THREE_CUES, FOURTH_CUE]));
    const r = trailAt(sought(doc, 180, 'the four throws'), 'arcs');
    expect(r.traces.map((t) => t.start), `the kept traces start at 2, 4 and 6 s, the 30° one (0 s) dropped; got ${r.traces.map((t) => s(t.start)).join(', ')} s`)
      .toEqual([2, 4, 6].map((x) => x * FLICKS));
    for (const t of r.traces) expect(t.points.length, `the trace from ${s(t.start)} s holds points`).toBeGreaterThan(1);
  }, TIMEOUT);

  it(`${ac(3)} frames 20, 55, 100 and 144, each sought in a fresh process, draw the played frames' pixels, traces and all`, () => {
    requireGpu();
    const d = dir();
    const doc = writeJson(d, 'throws.json', throwDoc(THREE_CUES));
    const bare = writeJson(d, 'throws-bare.json', throwDoc(THREE_CUES, false));
    const SOUGHT = [20, 55, 100, 144];
    const bin = bins.bin('deep-gpu');
    const [playedReply] = run(bin, d, [view3d({ doc, fps: FPS, from: 0, frames: 145, trails: ['arcs'] })]);
    const played = new Map(trailFrames(playedReply!, 'the three throws, played', ['arcs']).map((f) => [f.frame, f]));
    expect([...played.keys()], 'the played run holds frames 0 to 144').toEqual(Array.from({ length: 145 }, (_, n) => n));
    const hashes = SOUGHT.map((n) => played.get(n)!.pixelHash);
    hashes.forEach((h, i) => expect(h, `frame ${SOUGHT[i]} has a pixel hash`).toMatch(/^[0-9a-f]{64}$/));
    expect(new Set(hashes).size, 'the four frames\' pixels differ (the ball flies)').toBe(SOUGHT.length);
    const fails: string[] = [];
    for (const n of SOUGHT) {
      const f = sought(doc, n, 'the three throws');
      const traces = trailAt(f, 'arcs').traces;
      const want = n < 48 ? 1 : n < 96 ? 2 : 3;
      if (traces.length !== want || traces.some((t) => t.points.length < 2)) fails.push(`frame ${n}: the trail draws ${traces.length} traces of ${traces.map((t) => t.points.length).join(', ')} points, not ${want} with points`);
      if (f.pixelHash !== played.get(n)!.pixelHash) fails.push(`frame ${n}: seeking gives pixel hash ${f.pixelHash?.slice(0, 12)}, playing ${played.get(n)!.pixelHash?.slice(0, 12)}`);
      const [bareReply] = run(bin, d, [view3d({ doc: bare, fps: FPS, from: n, frames: 1 })]);
      const without = framesOf(bareReply!, `the throws without arcs, frame ${n}`).find((x) => x.frame === n)?.pixelHash;
      if (without === f.pixelHash) fails.push(`frame ${n}: the document without its trail draws the same pixels, so the traces aren't drawn`);
    }
    none(fails, 'seek against play by pixel hash');
  }, TIMEOUT);
});

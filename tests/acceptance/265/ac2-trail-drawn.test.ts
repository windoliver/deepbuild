// AC2 #265.18266a41: "A `mark.line` trail behind an item whose position array declares `interpolate: linear` and moves at
// 10 m/s starts at the item as drawn, its newest point within 1e-6 m of the drawn position at every sampled frame; a
// planted trail that reads the stored step values starts up to 0.17 m ahead and fails, naming the trail"
//
// The runner (helpers.ts: runnerDoc): the logic item `run` writes, at step k of 60 a second, its `x` = −10 + k ÷ 6, a
// write declaring `interpolate: linear`, which a driver places the box `runner` at (10 m/s); the line `streak` trails it,
// its span window the last 0.5 s in 16 segments. `view3d` plays it at 144 fps (frames 0 to 432), so frames fall at
// every share of a step, with #450's `trails` and #429's `evaluate` of `items/runner/at/pos`. At 20 seeded frames from
// 0.6 s on:
// - the trail's newest point lies within 1e-6 m (each axis) of the runner's position as the frame evaluates it, and of
//   the position drawing gives it, step k − 1's value blended toward step k's (Logic: interpolated writes);
// - each earlier point i, at t − (16 − i) × 0.5 ÷ 16 s, lies within 1e-6 m of where the runner was drawn then (Scope:
//   each sample reads the array as drawing read it at that sample's time), so the trail is the drawn path, not the item
//   repeated.
// The planted `trail_reads_stored_steps` (README: Planted programs) fails the same judge, naming the trail `streak`, its
// newest point ahead of the item by more than 1e-6 m and by no more than 0.17 m.
// Wrong programs: the base (a trail behind an item a logic array moves is refused at check); a trail through the stored
// step values; one a step behind; one from earlier frames.

import { describe, expect, it } from 'vitest';
import {
  STEP, TIMEOUT, ac, axisGap, failsNaming, fmtV, frameFlicks, none, putPrograms, random, requireGpu, run, runnerDoc, runnerDrawn,
  trailAt, trailFrames, useBins, useDir, v3, valuesOf, view3d, writeJson, type Planted, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FPS = 144;
const FRAMES = 433;
const SEGMENTS = 16;
const SPAN = 0.5;
const POINT = (SPAN * 705_600_000) / SEGMENTS;
const SAMPLED = ((): number[] => {
  const rnd = random(2265);
  const out = new Set<number>();
  while (out.size < 20) out.add(87 + Math.floor(rnd() * (FRAMES - 87)));
  return [...out].sort((a, b) => a - b);
})();

/** The trail against the runner as drawn at each sampled frame; each failure names the trail. Also the largest lead of
 * its newest point over the drawn runner along +x. */
function judge(planted?: Planted): { failures: string[]; lead: number } {
  const f = runnerDoc();
  const doc = writeJson(dir(), 'runner.json', f.doc);
  const [reply] = run(bins.bin('deep-gpu'), dir(), [view3d({ doc, assets: putPrograms(dir(), f.programs), fps: FPS, from: 0, frames: FRAMES, trails: ['streak'], evaluate: ['items/runner/at/pos'] })], planted ? { planted } : {});
  const what = `the runner at ${FPS} fps${planted ? `, planted ${planted}` : ''}`;
  const trails = new Map(trailFrames(reply!, what, ['streak']).map((x) => [x.frame, trailAt(x, 'streak')]));
  const values = valuesOf(reply!, what);
  const failures: string[] = [];
  let lead = 0;
  for (const n of SAMPLED) {
    const t = frameFlicks(n, FPS);
    const at = `the trail streak at frame ${n} (${(t / 705_600_000).toFixed(6)} s)`;
    const r = trails.get(n);
    if (!r || r.traces.length !== 1) { failures.push(`${at}: draws ${r?.traces.length ?? 0} traces, not one`); continue; }
    const pts = r.traces[0]!.points;
    if (pts.length !== SEGMENTS + 1) { failures.push(`${at}: holds ${pts.length} points, not ${SEGMENTS + 1}`); continue; }
    const newest = pts[SEGMENTS]!;
    const evaluated = v3(values.get(n)?.['items/runner/at/pos'], `${at}: the runner's evaluated position`);
    const want = runnerDrawn(t);
    lead = Math.max(lead, newest[0] - want[0]);
    if (axisGap(newest, evaluated) > 1e-6) failures.push(`${at}: its newest point ${fmtV(newest, 9)} is ${axisGap(newest, evaluated).toExponential(3)} m from the runner as the frame evaluates it, ${fmtV(evaluated, 9)}`);
    if (axisGap(evaluated, want) > 1e-6) failures.push(`${at}: the runner is evaluated at ${fmtV(evaluated, 9)}, drawing blends it to ${fmtV(want, 9)}`);
    pts.forEach((p, i) => {
      const tau = t - (SEGMENTS - i) * POINT;
      const drawnThen: V3 = runnerDrawn(tau);
      if (i < SEGMENTS && axisGap(p, drawnThen) > 1e-6) failures.push(`${at}: point ${i}, at ${(tau / 705_600_000).toFixed(6)} s, is ${fmtV(p, 9)}, the runner was drawn at ${fmtV(drawnThen, 9)}`);
    });
    if (axisGap(newest, want) > 1e-6) failures.push(`${at}: starts ${(newest[0] - want[0]).toFixed(6)} m ahead of the runner as drawn, ${fmtV(newest, 9)} against ${fmtV(want, 9)}`);
  }
  expect(STEP, 'a step of the 60 Hz item is 11,760,000 flicks').toBe(11_760_000);
  return { failures, lead };
}

describe(`${ac(2)} a mark.line trail behind a linear write starts at the item as drawn`, () => {
  it(`${ac(2)} at every sampled frame its newest point lies within 1e-6 m of the runner's drawn position, and each point where the runner was drawn then`, () => {
    requireGpu();
    none(judge().failures, 'the trail against the runner as drawn');
  }, TIMEOUT);

  it(`${ac(2)} (planted) a trail that reads the stored step values starts up to 0.17 m ahead and fails, naming the trail`, () => {
    requireGpu();
    const { failures, lead } = judge('trail_reads_stored_steps');
    failsNaming(failures, ['the trail streak'], 'the planted trail_reads_stored_steps');
    expect(lead, 'the planted trail starts ahead of the runner as drawn, by up to 0.17 m').toBeGreaterThan(1e-6);
    expect(lead, 'the planted trail starts ahead of the runner as drawn, by up to 0.17 m').toBeLessThanOrEqual(0.17);
  }, TIMEOUT);
});

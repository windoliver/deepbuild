// AC14 #492.9a173ea6: A ramp from 2.4 to 0.25 at 1.2 s over 0.7 s with in_out_quad reads child time 2.88 s at t = 1.2 s,
// 3.594583 s at 1.55 s, 3.8075 s at 1.9 s and 4.3825 s at 4.2 s within 1e-6 s, with .rate 2.4, 1.325 and 0.25 at 1.2, 1.55 and
// 1.9 s, the same at 24 and 60 fps and by seeking; a planted ramp that sums the rate times the frame step reads 3.5367 s at
// 24 fps and 3.5275 s at 60 fps at t = 1.5 s, where the closed form reads 3.5210 s, and fails, naming the remap; and hold_at
// {at: 1.6 s, for: 1.4 s} reads child time 1.6 s from 1.6 s to 3.0 s and t − 1.4 s after, with .rate 0 inside.
//
// Through `deep-motion eval`. A ruler clip's x reads child time and its `.rate` the child's rate, slope 1 times the remap's
// derivative. `ease` is left out: in_out_quad is the field's default. Every expected number is the issue's, and `rampChild`
// computes the closed form too, as a check on the text. The plant's reads are the left Riemann sum from 0 at the document's
// frame step, which is the sum that gives the issue's 3.5367 and 3.5275 (README: Planted programs). No upstream test.
import { describe, expect, it } from 'vitest';
import { AC, RULER, TIMEOUT, accepted, evalAll, evalOk, evalPlanted, failsNaming, film, fl, none, place, posOr, rampChild, rampRate, rateOr, rect, secs, useMotion, type Accepted, type JsonObject } from './helpers.ts';

const motion = useMotion();

const RAMP = { from: 2.4, to: 0.25, at: 1.2, over: 0.7 };
const rampDoc = (fps: number): JsonObject => film(`ramp-${fps}`, [rect('dot', [0, 0])], {
  clips: { ruler: RULER },
  placements: { p: place('ruler', 'dot', { start: '0s' }) },
  time_remaps: { slow: { target: 'p', map: { ramp: { from: '12/5', to: '1/4', at: '1.2s', over: '0.7s' } } } },
}, { span: '6s', frame_rate: `${fps}/1` });
const CHILD: [number, number][] = [[1.2, 2.88], [1.55, 3.594583], [1.9, 3.8075], [4.2, 4.3825]];
const RATE: [number, number][] = [[1.2, 2.4], [1.55, 1.325], [1.9, 0.25]];
const TIMES = [...new Set([...CHILD, ...RATE].map(([t]) => fl(t)))].sort((a, b) => a - b);

/** The check: every read within 1e-6 s of the issue's. Failures name the remap. */
function rampFailures(a: Accepted, what: string): string[] {
  const failures: string[] = [];
  const frame = (s: number) => a.frames[TIMES.indexOf(fl(s))]!;
  for (const [s, want] of CHILD) {
    const got = posOr(frame(s), 'dot', 0);
    if (!(Math.abs(got - want) <= 1e-6)) failures.push(`${what}: remap slow reads child ${got} s at ${s} s, not ${want} s`);
  }
  for (const [s, want] of RATE) {
    const got = rateOr(frame(s), 'p', 'x');
    if (!(Math.abs(got - want) <= 1e-6)) failures.push(`${what}: remap slow reads .rate ${got} at ${s} s, not ${want}`);
  }
  return failures;
}

describe(`${AC[14]} the ramp and hold_at presets`, () => {
  it(`${AC[14]} the ramp reads the issue's child times and rates, the same at 24 and 60 fps and by seeking`, () => {
    for (const [s, want] of CHILD) expect(Math.abs(rampChild(s, RAMP) - want), `fixture: the closed form at ${s} s against the issue's number`).toBeLessThanOrEqual(1e-6);
    for (const [s, want] of RATE) expect(Math.abs(rampRate(s, RAMP) - want), `fixture: the rate at ${s} s against the issue's number`).toBeLessThanOrEqual(1e-9);
    const [at24, at60, ...seeks] = evalAll(motion.bin(), [{ doc: rampDoc(24), times: TIMES }, { doc: rampDoc(60), times: TIMES }, ...TIMES.map((t) => ({ doc: rampDoc(60), times: [t] }))]);
    const a = accepted(at24!, TIMES, 'the ramp at 24 fps'); const b = accepted(at60!, TIMES, 'the ramp at 60 fps');
    none([...rampFailures(a, '24 fps'), ...rampFailures(b, '60 fps')], 'the ramp');
    const failures: string[] = [];
    TIMES.forEach((t, i) => {
      const got = posOr(a.frames[i]!, 'dot', 0); const other = posOr(b.frames[i]!, 'dot', 0);
      const seek = posOr(accepted(seeks[i]!, [t], `the seek to ${t}`).frames[0]!, 'dot', 0);
      if (!Object.is(got, other) || !Object.is(other, seek)) failures.push(`at ${t} flicks: 24 fps ${got}, 60 fps ${other}, seek ${seek}`);
    });
    none(failures, 'the same at each rate and by seeking');
  }, TIMEOUT);

  const leftSum = (s: number, fps: number): number => {
    let c = 0;
    for (let k = 0; k < Math.round(s * fps); k++) c += rampRate(k / fps, RAMP) / fps;
    return c;
  };

  it(`${AC[14]} a planted ramp that sums the rate times the frame step reads 3.5367 s at 24 fps and 3.5275 s at 60 fps at 1.5 s, where the closed form reads 3.5210 s, and fails, naming the remap`, () => {
    expect(Math.abs(rampChild(1.5, RAMP) - 3.521), 'fixture: the closed form at 1.5 s').toBeLessThanOrEqual(5e-5);
    expect(Math.abs(leftSum(1.5, 24) - 3.5367), 'fixture: the sum at 24 fps').toBeLessThanOrEqual(5e-5);
    expect(Math.abs(leftSum(1.5, 60) - 3.5275), 'fixture: the sum at 60 fps').toBeLessThanOrEqual(5e-5);
    const t = fl(1.5);
    const real = evalOk(motion.bin(), { doc: rampDoc(24), times: [t] }, 'the ramp at 1.5 s');
    expect(Math.abs(posOr(real.frames[0]!, 'dot', 0) - 3.521), `the real ramp at 1.5 s reads ${posOr(real.frames[0]!, 'dot', 0)}`).toBeLessThanOrEqual(5e-5);
    for (const [fps, want] of [[24, 3.5367], [60, 3.5275]] as [number, number][]) {
      const atStep = evalPlanted(motion.bin(), { doc: rampDoc(fps), times: [t], planted: 'ramp_sums_per_frame' }, `the summed ramp at ${fps} fps`);
      expect(Math.abs(posOr(atStep.frames[0]!, 'dot', 0) - want), `the plant at ${fps} fps reads ${posOr(atStep.frames[0]!, 'dot', 0)}, not ${want}`).toBeLessThanOrEqual(5e-5);
      const plant = evalPlanted(motion.bin(), { doc: rampDoc(fps), times: TIMES, planted: 'ramp_sums_per_frame' }, `the summed ramp at ${fps} fps`);
      failsNaming(rampFailures(plant, `${fps} fps`), ['remap slow'], `the summed ramp at ${fps} fps`);
    }
  }, TIMEOUT);

  it(`${AC[14]} hold_at {at: 1.6 s, for: 1.4 s} reads child 1.6 s from 1.6 s to 3.0 s and t − 1.4 s after, with .rate 0 inside`, () => {
    const doc = film('hold-at', [rect('dot', [0, 0])], {
      clips: { ruler: RULER }, placements: { p: place('ruler', 'dot', { start: '0s' }) }, time_remaps: { pause: { target: 'p', map: { hold_at: { at: '1.6s', for: '1.4s' } } } },
    }, { span: '6s' });
    const child = (s: number): number => (s < 1.6 ? s : s <= 3 ? 1.6 : s - 1.4);
    const times = [1, 1.59, 1.6, 2, 2.9, 3, 3.1, 4.5].map(fl);
    const a = evalOk(motion.bin(), { doc, times }, 'hold_at');
    const failures = a.frames.flatMap((f) => {
      const s = secs(f.t); const got = posOr(f, 'dot', 0);
      return Math.abs(got - child(s)) <= 1e-8 ? [] : [`child at ${s} s reads ${got}, not ${child(s)}`];
    });
    for (const f of a.frames) {
      const s = secs(f.t); const r = rateOr(f, 'p', 'x');
      if (s > 1.6 && s < 3 && r !== 0) failures.push(`.rate at ${s} s reads ${r} inside the hold`);
      if ((s < 1.6 || s > 3) && !(Math.abs(r - 1) <= 1e-9)) failures.push(`.rate at ${s} s reads ${r} outside the hold`);
    }
    none(failures, 'hold_at');
  }, TIMEOUT);
});

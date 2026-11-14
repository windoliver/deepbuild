// #522.c32bed6d: "In the ball-and-goal lab with a 60 s span and no bake, a grab at 2 s and then a seek to 50 s need 5,760
// steps: no frame's simulate phase passes the render worker's 4 ms of CPU (its `eval_ns`), the UI thread stays under 2 ms
// a frame, the lab shows its last stepped state marked stale until the 50 s frame lands, and that frame equals a straight
// run's by step hash. A second seek, to 10 s, made after the steps pass 10 s and before the 50 s frame lands, lands
// within one checkpoint spacing of steps. A planted simulate phase that runs all 5,760 steps in one frame passes 4 ms in
// that frame and fails, naming the frame"
//
// A live view of the lab (README: Worlds) with an empty track and no bake, over 60 s (README: `view`, `frame`). A seek
// frame to step 240 (2 s) and the frames until it lands; a frame with a new grab, stamped at step 241 (the playhead plus
// one step's input lead); a seek frame to step 6,000 (50 s) and the frames until it lands: 6,000 − 240 = 5,760 steps.
// The straight run is a bake of the lab with that grab on its track, 6,000 steps. Every frame from the 50 s seek on
// must show its last stepped state (`at` the steps run so far, its step hash the straight run's there), stale until the
// last, which shows step 6,000 with the straight run's hash. Timing: each frame's `eval_ns` within 4 ms and `ui_ns`
// under 2 ms is judged last, after everything else, and only on a reference Mac with the load at the session's start
// and end under the core count (scripts/benchmark.mjs's rule); elsewhere the test fails INCONCLUSIVE, never passing,
// never retried. The second seek runs in a second session, made once a frame shows more than 1,200 steps and is still
// stale; it must land on step 1,200 within 60 steps (the checkpoint spacing). `--planted simulate_runs_all_steps` runs
// every step a frame needs in that frame.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, FRAME_CPU_NS, TIMEOUT, UI_NS, ask, bakeCall, caught, hashesOf, inconclusive, lab, live, load, none, open, prebuild, standing,
  type Frame, type JsonObject, type Planted, type Session,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[9];
const SPAN = 60;
const TWO = 240;
const FIFTY = 6000;
const TEN = 1200;
const SPACING = 60;
const NEEDS = FIFTY - TWO;
const GRAB: JsonObject = { kind: 'grab', target: 'ball', data: { point: [0, 0, 0], plane: 'ground' } };

interface Ran { s: Session; stop: () => void; grab: JsonObject; seek50: number; landed: number | null; stopped: Frame | null; loads: { start: number; end: number } }
async function ran(planted?: Planted, stopWhen?: (f: Frame) => boolean): Promise<Ran> {
  const start = load();
  const l = live(planted);
  try {
    const { s } = await open(l, lab(), [], SPAN);
    const two = await s.land(await s.frame({ seek: TWO }));
    expect(two?.at, `the 2 s frame lands, showing the state after step ${TWO}`).toBe(TWO);
    const g = await s.frame({ input: GRAB });
    expect(g.stamped, 'the grab is stamped on the track').not.toBeNull();
    expect([g.stamped!['step'], g.stamped!['kind'], g.stamped!['target']], `at step ${TWO + 1}, the playhead plus one step's input lead`).toEqual([TWO + 1, 'grab', 'ball']);
    const seek50 = s.frames.length;
    const at50 = await s.frame({ seek: FIFTY });
    let landed: number | null = null;
    let stopped: Frame | null = null;
    if (stopWhen) stopped = await s.land(at50, stopWhen);
    else if (await s.land(at50)) landed = s.frames.length - 1;
    return { s, stop: () => l.stop(), grab: g.stamped!, seek50, landed, stopped, loads: { start, end: load() } };
  } catch (e) {
    l.stop();
    throw e;
  }
}
/** The straight run: the lab with the session's grab on its track, 6,000 steps. */
const straightOf = (grab: JsonObject): string[] => hashesOf(ask([bakeCall(lab(), [grab], FIFTY)])[0], 'the straight run of the lab with the grab');
/** Everything the criterion says of the frames that doesn't depend on load; each failure names its frame. */
function frameFailures(r: Ran, straight: string[]): string[] {
  const f: string[] = [];
  if (r.landed === null) return [`the 50 s frame didn't land within ${r.s.frames.length - r.seek50} frames`];
  const after = r.s.frames.slice(r.seek50, r.landed + 1);
  const steps = after.reduce((n, x) => n + x.steps, 0);
  if (steps !== NEEDS) f.push(`the grab at 2 s and the seek to 50 s ran ${steps} steps, not ${NEEDS}`);
  let at = r.s.frames[r.seek50 - 1]!.at;
  for (const x of after) {
    at += x.steps;
    if (x.at !== at) f.push(`frame ${x.frame}: it shows the state after ${x.at} steps, not its last stepped state (${at})`);
    else if (x.stepHash !== straight[x.at]) f.push(`frame ${x.frame}: the state it shows after ${x.at} steps isn't the straight run's there by step hash`);
    if (x !== after[after.length - 1] && !x.stale) f.push(`frame ${x.frame}: it isn't marked stale before the 50 s frame lands`);
  }
  const last = after[after.length - 1]!;
  if (last.stale || last.at !== FIFTY) f.push(`frame ${last.frame}: the 50 s frame landed at ${last.at} steps, stale ${last.stale}`);
  else if (last.stepHash !== straight[FIFTY]) f.push(`frame ${last.frame}: the 50 s frame isn't the straight run's by step hash`);
  return f;
}
/** The timing rules, every frame of the session; each failure names its frame. */
function timingFailures(frames: readonly Frame[]): string[] {
  const f: string[] = [];
  for (const x of frames) {
    if (x.evalNs > FRAME_CPU_NS) f.push(`frame ${x.frame}: its simulate phase took ${x.evalNs} ns of the render worker's CPU, past 4 ms (${x.steps} steps)`);
    if (x.uiNs >= UI_NS) f.push(`frame ${x.frame}: the UI thread took ${x.uiNs} ns, not under 2 ms`);
  }
  return f;
}

describe(`${ID} a grab at 2 s and a seek to 50 s in the lab with no bake run 5,760 steps across frames, stale until the 50 s frame lands`, () => {
  it(`${ID} the ${NEEDS} steps run across frames, each showing its last stepped state marked stale until the 50 s frame lands on the straight run's step hash; then each frame's simulate phase within 4 ms of eval_ns and its UI thread under 2 ms`, async () => {
    const r = await ran();
    try {
      none(frameFailures(r, straightOf(r.grab)), 'the frames from the seek to 50 s until it lands');
      const st = await standing(r.loads);
      if (st.status !== 'PASS') inconclusive(`the frames' CPU times are a reading on this machine, not the budget: ${st.reason}`);
      none(timingFailures(r.s.frames), 'every frame\'s simulate phase and UI thread');
    } finally { r.stop(); }
  }, TIMEOUT);

  it(`${ID} a second seek, to 10 s, made after the steps pass 10 s and before the 50 s frame lands, lands within one checkpoint spacing (${SPACING}) of steps`, async () => {
    const r = await ran(undefined, (f) => f.at > TEN);
    try {
      expect(r.stopped, 'a frame shows the steps past 10 s before the 50 s frame lands').not.toBeNull();
      expect([r.stopped!.stale, r.stopped!.at > TEN], 'that frame is still stale, past 10 s').toEqual([true, true]);
      const n = r.s.frames.length;
      const ten = await r.s.land(await r.s.frame({ seek: TEN }));
      expect(ten?.at, `the 10 s frame lands, showing the state after step ${TEN}`).toBe(TEN);
      const steps = r.s.frames.slice(n).reduce((k, f) => k + f.steps, 0);
      expect(steps, `it landed after ${steps} steps, within one checkpoint spacing`).toBeLessThanOrEqual(SPACING);
      expect(ten!.stepHash, 'on the straight run\'s state there').toBe(straightOf(r.grab)[TEN]);
    } finally { r.stop(); }
  }, TIMEOUT);

  it(`${ID} a planted simulate phase that runs all ${NEEDS} steps in one frame (simulate_runs_all_steps) passes 4 ms in that frame and fails, naming the frame`, async () => {
    const r = await ran('simulate_runs_all_steps');
    r.stop();
    const all = r.s.frames.find((f) => f.steps === NEEDS);
    expect(all, `one frame ran all ${NEEDS} steps`).toBeDefined();
    expect(all!.evalNs, 'its simulate phase passed 4 ms of CPU').toBeGreaterThan(FRAME_CPU_NS);
    const failures = timingFailures(r.s.frames);
    caught(failures, 'simulate_runs_all_steps');
    expect(failures.some((x) => x.startsWith(`frame ${all!.frame}: its simulate phase`)), `the criterion fails, naming frame ${all!.frame}: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});

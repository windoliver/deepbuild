// Criterion 5 (no upstream test): "A 100-boid flock at 60 Hz with a 60 s span and no bake, given a seek to 2 s, a
// wind-slider change there that forks the track, and then a seek to 50 s, needs 2,880 steps: no frame's simulate
// phase passes the render worker's 4 ms of CPU (its `eval_ns`), the UI thread stays under 2 ms a frame, the flock
// shows its last stepped state marked stale until the 50 s frame lands, and that state equals a straight run of the
// same track by full-state hash. A second seek, to 10 s, made after the steps pass 10 s and before the 50 s frame
// lands, lands within one checkpoint spacing of steps. A planted simulate phase that runs all 2,880 steps in one
// frame passes 4 ms in that frame and fails, naming the frame"
//
// Through `deep-logic view` and `frame` (README: view and frame), one live frame per call, and `bake`. The flock
// (flock.ts) has wind entries at steps 30, 300, 1,200 and 2,400. The 2 s frame needs steps 0 to 120; the wind change
// made at that frame is stamped at step 121 (the first step not yet run, one step's input lead past 2 s: Input
// track) and drops the entries after it; the 50 s frame needs steps 121 to 3,000, 2,880 of them. The straight run
// is a bake of the forked track, read at the state after step 3,000 (a probe at 3,000 with no entries, one step).
// `simulate_runs_all_steps` runs every step a frame needs in that frame.
import { describe, expect, it } from 'vitest';
import { AC, EVERY, FRAME_CPU_NS, STEP_60, TIMEOUT, UI_NS, bakeCall, bakeOf, frameCall, frameOf, live, logicBin, onMac, prebuild, str, viewCall, yours, type Entry, type Frame, type Live, type Planted } from './helpers.ts';
import { FLOCK, flockPiece } from './flock.ts';

prebuild(() => { logicBin(); });

const SPAN = 60;
const TRACK: Entry[] = [yours('wind', 30, 0.2), yours('wind', 300, -0.4), yours('wind', 1200, 0.6), yours('wind', 2400, -0.8)];
const WIND = 0.9;
const FORK_STEP = 121;
const NEEDS = 2880;
const FRAME_CAP = 50_000;

interface Run { frames: Frame[]; seek50: number; landed: number | null }
async function view(l: Live): Promise<string> {
  const v = await l.call(viewCall(flockPiece(), TRACK, SPAN));
  expect(v['ok'], `view opened the flock with no bake: ${JSON.stringify(v).slice(0, 400)}`).toBe(true);
  return str(v['session'], 'view.session');
}
async function frame(l: Live, session: string, frames: Frame[], act: Parameters<typeof frameCall>[1] = {}): Promise<Frame> {
  const f = frameOf(await l.call(frameCall(session, act)), `frame ${frames.length + 1}`);
  frames.push(f);
  return f;
}
/** Frames until the playhead's frame lands (or the cap). */
async function land(l: Live, session: string, frames: Frame[], first: Frame, until: (f: Frame) => boolean = () => false): Promise<Frame | null> {
  let f = first;
  for (let n = 0; f.stale && n < FRAME_CAP; n++) { if (until(f)) return f; f = await frame(l, session, frames); }
  return f.stale ? null : f;
}
/** Seek to 2 s and land, change the wind there, seek to 50 s and play frames until it lands. */
async function scenario(planted: Planted[] = [], stopWhen?: (f: Frame) => boolean): Promise<Run & { l: Live; session: string; stopped: Frame | null }> {
  const l = live(planted);
  const session = await view(l);
  const frames: Frame[] = [];
  const two = await land(l, session, frames, await frame(l, session, frames, { seek: 2 }));
  expect(two?.at, 'the 2 s frame lands, showing the state after step 120').toBe(FORK_STEP);
  const set = await frame(l, session, frames, { set: { control: 'wind', value: WIND } });
  expect(set.stamped, 'the wind change is stamped on the input track').not.toBeNull();
  expect([set.stamped!['t'], set.stamped!['control'], set.stamped!['value'], set.stamped!['writer']], 'at step 121, the first step not yet run').toEqual([FORK_STEP * STEP_60, 'wind', WIND, 'you']);
  expect(set.fork_at, 'and it forks the track there').toBe(FORK_STEP * STEP_60);
  const at50 = await frame(l, session, frames, { seek: 50 });
  const seek50 = frames.length - 1;
  const stopped = stopWhen ? await land(l, session, frames, at50, stopWhen) : null;
  const end = stopWhen ? null : await land(l, session, frames, at50);
  return { l, session, frames, seek50, landed: end ? frames.length - 1 : null, stopped };
}
/** The criterion's frame rules over a run, each failure naming its frame. */
function judge(r: Run): string[] {
  const failures: string[] = [];
  for (const f of r.frames) {
    if (f.eval_ns > FRAME_CPU_NS) failures.push(`frame ${f.frame}: its simulate phase took ${f.eval_ns} ns of the render worker's CPU, past 4 ms (${f.steps} steps)`);
    if (f.ui_ns >= UI_NS) failures.push(`frame ${f.frame}: the UI thread took ${f.ui_ns} ns, not under 2 ms`);
  }
  if (r.landed === null) return [...failures, `the 50 s frame didn't land within ${FRAME_CAP} frames`];
  const after = r.frames.slice(r.seek50, r.landed + 1);
  const steps = after.reduce((n, f) => n + f.steps, 0);
  if (steps !== NEEDS) failures.push(`the seek to 50 s ran ${steps} steps, not ${NEEDS}`);
  let at = r.frames[r.seek50 - 1]!.at;
  for (const f of after) {
    at += f.steps;
    if (f.at !== at) failures.push(`frame ${f.frame}: it shows the state after ${f.at} steps, not its last stepped state (${at})`);
    if (f !== after[after.length - 1] && !f.stale) failures.push(`frame ${f.frame}: it isn't marked stale before the 50 s frame lands`);
  }
  const last = after[after.length - 1]!;
  if (last.stale || last.at !== 3001) failures.push(`frame ${last.frame}: the 50 s frame landed at ${last.at} steps, stale ${last.stale}`);
  return failures;
}

describe(`${AC[5]} a seek across a fork runs its steps across frames on the render worker, within 4 ms a frame`, () => {
  it(`${AC[5]} a seek to 2 s, a wind change there and a seek to 50 s run 2,880 steps, each frame's simulate phase within 4 ms and its UI thread under 2 ms, stale until the 50 s frame lands on a straight run's full-state hash`, async () => {
    const r = await scenario();
    try {
      const failures = judge(r);
      expect(failures, `every frame keeps to the criterion:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
      const [straightReply] = onMac([bakeCall(flockPiece(), { steps: 3001, track: [TRACK[0]!, yours('wind', FORK_STEP, WIND)], probes: [{ at: 3000, entries: [], steps: 1 }] })]);
      const straight = bakeOf(straightReply!, 'a straight bake of the forked track');
      expect(r.frames[r.landed!]!.deep_hash[FLOCK], 'the 50 s frame\'s state equals a straight run of the same track by full-state hash').toBe(straight.probes[0]?.deep_hash[FLOCK]);
    } finally { r.l.stop(); }
  }, TIMEOUT);

  it(`${AC[5]} a second seek, to 10 s, made after the steps pass 10 s and before the 50 s frame lands, lands within one checkpoint spacing of steps`, async () => {
    const r = await scenario([], (f) => f.at > 601);
    try {
      expect(r.stopped, 'a frame shows the steps past 10 s before the 50 s frame lands').not.toBeNull();
      expect(r.stopped!.stale, 'that frame is still stale').toBe(true);
      const frames: Frame[] = [];
      const ten = await land(r.l, r.session, frames, await frame(r.l, r.session, frames, { seek: 10 }));
      expect(ten, 'the 10 s frame lands').not.toBeNull();
      expect(ten!.at, 'showing the state after step 600').toBe(601);
      const steps = frames.reduce((n, f) => n + f.steps, 0);
      expect(steps, `the 10 s frame landed after ${steps} steps, within one checkpoint spacing (${EVERY})`).toBeLessThanOrEqual(EVERY);
    } finally { r.l.stop(); }
  }, TIMEOUT);

  it(`${AC[5]} a planted simulate phase that runs all 2,880 steps in one frame (simulate_runs_all_steps) passes 4 ms in that frame and fails, naming the frame`, async () => {
    const r = await scenario(['simulate_runs_all_steps']);
    r.l.stop();
    const all = r.frames.find((f) => f.steps === NEEDS);
    expect(all, `one frame ran all ${NEEDS} steps`).toBeDefined();
    expect(all!.eval_ns, 'its simulate phase passed 4 ms of CPU').toBeGreaterThan(FRAME_CPU_NS);
    const failures = judge(r);
    expect(failures.some((f) => f.startsWith(`frame ${all!.frame}: its simulate phase`)), `the criterion fails, naming frame ${all!.frame}: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});

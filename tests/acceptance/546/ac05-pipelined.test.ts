// Criterion 5 (no upstream test): "A 600-unit item at 30 Hz with only linear and hold writes runs pipelined: no
// render-worker frame passes 4 ms, its full-state hashes equal an inline run's at every step, and logic.budget holds
// it to twice the 30 Hz ceiling deep_kinds returns, within one fuel unit; a planted pipeline that draws a step's arrays
// before the step ends fails, naming the first frame and the array"
//
// `crowd` (programs.ts): 600 units at 30 Hz, `pos` (vec2, linear) and `phase` (i32, hold), in a figure piece, its
// step sized from two calibration bakes to about 1.6 times the figure class's 30 Hz app ceiling deep_kinds returns, or
// 9,000,000 fuel when that is less (about 9 ms of CPU on this Mac at 9,000,000: its work is a square root and division
// chain), so run inline it would pass 4 ms. Its check reads it pipelined; logic.budget on [app] passes it, reads it
// pipelined and holds it to twice the 30 Hz ceiling within one fuel unit. A live view then plays 2 s, one 60 Hz frame
// at a time (README: view and frame): no frame's render-worker CPU passes 4 ms; every step 0 to 60 ends once, its
// full-state hash the inline bake's after that step; and each frame draws both arrays at the step due at its time,
// a step that has already ended, with the values the bake's step left. `pipeline_draws_before_step_ends` draws a
// step's arrays before it ends, and the judgement fails, its first failure naming the frame and the array.
import { describe, expect, it } from 'vitest';
import {
  AC, FRAME, TIMEOUT, arrayHash, bakeCall, bakeOf, bins, budgetCall, budgetOf, ceilingOf, checkCall, failsNaming, frameCall,
  frameOf, fuelOf, line, live, none, obj, onMac, piece, prebuild, stepLength, stepTable, viewCall, type Bake, type Frame,
  type JsonObject, type LogicPlanted,
} from './helpers.ts';
import { crowd, crowdParams } from './programs.ts';

prebuild(() => { bins(); });

const ID = 'crowd';
const ARRAYS = { [`${ID}.pos`]: 'vec2', [`${ID}.phase`]: 'i32' } as const;
const LEN = stepLength(30);
/** Frames 1 to 121: t = 0 to 2 s, so steps 0 to 60 come due. */
const FRAMES = 121;
const LAST = 60;
const BAKED = 64;
const WORKER_NS = 4_000_000;

interface Setup { c30: number; p: JsonObject; bake: Bake }
let made: Setup | undefined;
function setup(): Setup {
  if (made) return made;
  const c30 = ceilingOf(stepTable(), 30, 'figure', 'app');
  const fuelAt = (w: number): number => {
    const [r] = onMac([bakeCall(piece({ seed: 546_05, class: 'figure', items: { [ID]: { program: crowd(w), params: crowdParams() } } }), { steps: 2 })]);
    return fuelOf(bakeOf(r!, `crowd's calibration bake (W = ${w})`), ID).get(1)!;
  };
  const [f0, f50] = [fuelAt(0), fuelAt(50)];
  const target = Math.min(1.6 * c30, 9_000_000);
  const w = Math.floor((target - f0) / ((f50 - f0) / 50));
  expect(w, `crowd's work per unit for a step of about ${target} fuel`).toBeGreaterThan(0);
  const p = piece({ seed: 546_05, class: 'figure', items: { [ID]: { program: crowd(w), params: crowdParams() } } });
  const [r] = onMac([bakeCall(p, { steps: BAKED })]);
  const bake = bakeOf(r!, 'crowd\'s inline bake');
  expect(bake.traps, 'crowd doesn\'t trap').toEqual([]);
  return (made = { c30, p, bake });
}

/** Plays the view frame by frame: frame 1 at t = 0, then one 60 Hz frame each. */
async function play(planted: LogicPlanted[]): Promise<Frame[]> {
  const { p } = setup();
  const l = live(planted);
  try {
    const v = await l.call(viewCall(p, 2.2));
    expect(v['ok'], `the view opens: ${JSON.stringify(v).slice(0, 400)}`).toBe(true);
    expect(obj(obj(v['items'], 'view.items')[ID], `view.items.${ID}`)['pipelined'], 'the view\'s check reads crowd pipelined').toBe(true);
    const session = String(v['session']);
    const frames: Frame[] = [];
    for (let n = 1; n <= FRAMES; n++) frames.push(frameOf(await l.call(frameCall(session, n > 1)), `frame ${n}`));
    return frames;
  } finally {
    l.stop();
  }
}

/** What the criterion asks of the frames, in frame order: drawn steps due and ended, with the bake's values; every step's full-state hash the bake's; no frame past 4 ms. */
function pipelineProblems(frames: Frame[], bake: Bake): string[] {
  const out: string[] = [];
  const deep = new Map((bake.checkpoints[ID] ?? []).map((c) => [c.step, c.deep_hash]));
  const hashes = new Map(bake.steps.map((s) => [s.step, Object.fromEntries(Object.entries(ARRAYS).map(([name, type]) => [name, arrayHash(s.arrays[name] ?? [], type)]))]));
  const ended = new Map<number, string>();
  for (const [i, f] of frames.entries()) {
    const n = i + 1;
    if (f.t !== (n - 1) * FRAME) out.push(`frame ${n} is at t ${f.t}, not ${(n - 1) * FRAME} (one 60 Hz frame on from the one before)`);
    for (const e of f.ended[ID] ?? []) {
      if (ended.has(e.step)) out.push(`frame ${n} reports step ${e.step} ended again`);
      ended.set(e.step, e.deep_hash);
      const want = deep.get(e.step + 1);
      if (want !== undefined && e.deep_hash !== want) out.push(`frame ${n}: step ${e.step}'s full-state hash is ${e.deep_hash}; the inline run's after it is ${want}`);
    }
    const due = Math.floor(f.t / LEN);
    for (const name of Object.keys(ARRAYS)) {
      const d = f.drawn[name];
      if (!d) { out.push(`frame ${n} draws no ${name}`); continue; }
      if (d.step !== due) out.push(`frame ${n} draws ${name} at step ${d.step}, not step ${due}, the last at or before its time`);
      if (!ended.has(d.step)) out.push(`frame ${n} draws ${name} at step ${d.step} before step ${d.step} ends`);
      const want = hashes.get(d.step)?.[name];
      if (d.hash !== want) out.push(`frame ${n} draws ${name} at step ${d.step} with values ${d.hash}; the inline run's step ${d.step} left ${String(want)}`);
    }
    if (f.eval_ns > WORKER_NS) out.push(`frame ${n}'s render worker took ${f.eval_ns} ns of CPU, past 4 ms`);
  }
  for (let k = 0; k <= LAST; k++) if (!ended.has(k)) out.push(`step ${k} never ends in the frames that play 2 s`);
  return out;
}

describe(`${AC[5]} a slow item steps on the logic thread, one step ahead of what the frames draw`, () => {
  it(`${AC[5]} the 600-unit item runs pipelined: no render-worker frame past 4 ms, full-state hashes the inline run's at every step, logic.budget holds it to twice the 30 Hz ceiling`, async () => {
    const { c30, p, bake } = setup();
    const [check, budget] = onMac([checkCall(p), budgetCall(p, { steps: BAKED }, ['app'])]);
    expect(obj(obj(check!['items'], 'check.items')[ID], `check.items.${ID}`)['pipelined'], 'the check reads crowd pipelined').toBe(true);
    const b = budgetOf(budget!, 'logic.budget of crowd');
    expect(b.failures.map(line), 'logic.budget finds nothing in crowd').toEqual([]);
    expect(b.verdict, 'logic.budget passes crowd').toBe('PASS');
    expect(b.items[ID]?.pipelined, 'logic.budget reads crowd pipelined').toBe(true);
    const held = b.items[ID]?.ceiling['app'];
    expect(held !== undefined && Math.abs(held - 2 * c30) <= 1, `logic.budget holds crowd to ${String(held)}: twice the 30 Hz ceiling ${c30}, within one fuel unit`).toBe(true);
    none(pipelineProblems(await play([]), bake), 'the pipelined live view');
  }, TIMEOUT);

  it(`${AC[5]} pipeline_draws_before_step_ends fails, naming the first frame and the array`, async () => {
    const { bake } = setup();
    const problems = pipelineProblems(await play(['pipeline_draws_before_step_ends']), bake);
    failsNaming(problems, ['before step'], 'pipeline_draws_before_step_ends');
    expect(problems[0], 'the first failure names its frame and the array').toMatch(/^frame \d+ draws crowd\.(pos|phase) at step \d+/);
  }, TIMEOUT);
});

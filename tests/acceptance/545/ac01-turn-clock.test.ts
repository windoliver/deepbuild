// Criterion 1 (no upstream test): "A turn game at 60 Hz with clock on_input that reads one choice control, idle for 60
// s after step 0, runs no step, adds no step hash, array range or checkpoint to its bake, and its view submits no frame
// in those 60 s with nothing else moving; an entry stamped at 30.008 s runs step 1,801, the first step at or after it,
// exactly once, with seed hash(document seed, logic ID, 1,801); and a planted module that runs the entry at the step of
// the next 30 fps frame boundary, step 1,802, fails, naming the entry and both steps"
//
// Through `deep-logic bake` (its step records, `checkpoints` and `ranges`) and a live `view` (each frame's `steps`,
// `deep_hash` and `valid_until`) (README: deep-logic). The turn game (programs.ts) counts the steps it runs in `ran`,
// writes the step that read a move in `move_at` and that step's seed in `move_seed`, and after a move takes the AI's
// turn of 8 + (m mod 8) steps through `due` (criterion 2), so the entry at 30.008 s runs steps 1,801 to 1,810.
// 30.008 s is flick 21,173,644,800, step 1,800.48 at 60 Hz: step 1,801 is the first at or after it, and the next 30 fps
// frame boundary, 30.0333 s, is step 1,802. hash(document seed, logic ID, k) is read as the seed step k gets on a fixed
// clock (#531's rule), from a bake of the same program at `clock: fixed`.
// `turn_runs_at_frame_boundary` runs an entry at the step of the next 30 fps frame boundary at or after its stamp.
import { describe, expect, it } from 'vitest';
import {
  AC, STEP_60, TIMEOUT, bakeCall, bakeOf, drawn, entry, failsNaming, fmt, live, logic, logicBin, none, openView, piece, prebuild, ranSteps,
  type Bake, type JsonObject, type Planted,
} from './helpers.ts';
import { CHOICE, CONTROLS, turnItem, work } from './programs.ts';

prebuild(() => { logicBin(); });

const ID = 'turn';
const SEED = 545_01;
/** 30.008 s × 705,600,000. */
const ENTRY_T = 21_173_644_800;
const ENTRY_STEP = 1801;
const VALUE = 2;
const ENTRY = entry(CHOICE, ENTRY_T, VALUE);
/** Steps 0 to 3,600: 0 to 60 s. */
const STEPS = 3601;
/** The steps the turn clock runs on the entry's track: step 0, the move at 1,801 and the AI's turn after it. */
const RUN = [0, ...Array.from({ length: work(ENTRY_STEP) + 1 }, (_, j) => ENTRY_STEP + j)];
const NAMED = `the entry at 30.008 s (flick ${fmt(ENTRY_T)}, control ${CHOICE}, value ${VALUE})`;

const game = (clock: 'on_input' | 'fixed'): JsonObject => piece({ seed: SEED, controls: CONTROLS, items: { [ID]: turnItem(clock) } });
const one = (v: unknown): string => JSON.stringify(v);

/** The seed every step gets on a fixed clock: hash(document seed, logic ID, k), by step. */
function fixedSeeds(): Map<number, string> {
  const [reply] = logic([bakeCall(game('fixed'), { track: [ENTRY], steps: RUN[RUN.length - 1]! + 2 })]);
  const b = bakeOf(reply!, 'the fixed-clock bake');
  return new Map(b.steps.map((s) => [s.step, one(s.arrays[`${ID}.seed`])]));
}

/** The criterion over a bake of the entry's track, each failure naming the entry and the steps. */
function judgeEntry(b: Bake, seeds: Map<number, string>): string[] {
  const failures: string[] = [];
  const ran = ranSteps(b.steps, ID);
  const reading = ran.find((s) => s.arrays[`${ID}.moves`]?.[0] === 1);
  const at = reading?.step ?? null;
  if (at !== ENTRY_STEP) failures.push(`${NAMED} ran at step ${at === null ? 'none' : fmt(at)}, not step ${fmt(ENTRY_STEP)}, the first step at or after it`);
  if (reading && reading.arrays[`${ID}.move_at`]?.[0] !== reading.step) failures.push(`step ${fmt(reading.step)} read the entry but its ${ID}.move_at is ${one(reading.arrays[`${ID}.move_at`])}`);
  if (reading && one(reading.arrays[`${ID}.move_seed`]) !== seeds.get(ENTRY_STEP)) {
    failures.push(`${NAMED} ran with seed ${one(reading.arrays[`${ID}.move_seed`])}, not hash(document seed, ${ID}, ${fmt(ENTRY_STEP)}) = ${seeds.get(ENTRY_STEP)}`);
  }
  const steps = ran.map((s) => s.step);
  if (one(steps) !== one(RUN)) failures.push(`the item ran steps ${steps.map(fmt).join(', ')}, not ${RUN.map(fmt).join(', ')}`);
  ran.forEach((s, i) => {
    if (s.arrays[`${ID}.ran`]?.[0] !== i + 1) failures.push(`step ${fmt(s.step)}: ${ID}.ran is ${one(s.arrays[`${ID}.ran`])}, not ${i + 1}: a step ran more than once, or ran with no record`);
    if (s.arrays[`${ID}.k`]?.[0] !== s.step) failures.push(`step ${fmt(s.step)} ran as step ${one(s.arrays[`${ID}.k`])}: steps keep their numbers`);
    if (seeds.has(s.step) && one(s.arrays[`${ID}.seed`]) !== seeds.get(s.step)) failures.push(`step ${fmt(s.step)} ran with seed ${one(s.arrays[`${ID}.seed`])}, not the fixed clock's ${seeds.get(s.step)}`);
  });
  const cps = (b.checkpoints[ID] ?? []).map((c) => c.step);
  if (one(cps) !== one([0])) failures.push(`the bake holds checkpoints at ${cps.map(fmt).join(', ')}, not only the first at step 0: ${RUN.length} steps ran`);
  if (b.ranges === null) failures.push('the bake reports no array ranges');
  else {
    const list = b.ranges[ID] ?? [];
    const off = list.filter((r) => !RUN.includes(r.step));
    if (off.length) failures.push(`the bake holds array ranges at steps that didn't run: ${off.slice(0, 5).map((r) => `step ${fmt(r.step)} ${r.array}`).join('; ')}`);
    if (!list.some((r) => r.step === ENTRY_STEP && r.array === 'move_at' && r.start === 0 && r.end === 1 && one(r.values) === one([ENTRY_STEP]))) {
      failures.push(`the bake holds no range of move_at = [${ENTRY_STEP}] at step ${fmt(ENTRY_STEP)}: ${JSON.stringify(list.filter((r) => r.step === ENTRY_STEP)).slice(0, 400)}`);
    }
  }
  return failures;
}

function entryBake(planted: Planted[] = []): Bake {
  const [reply] = logic([bakeCall(game('on_input'), { track: [ENTRY], steps: STEPS })], planted);
  return bakeOf(reply!, `the bake of the entry's track${planted.length ? ` with ${planted.join(', ')}` : ''}`);
}

describe(`${AC[1]} a turn clock runs only the steps an entry, a reading or due calls for`, () => {
  it(`${AC[1]} idle for 60 s after step 0 the game runs no step, adds no step hash, array range or checkpoint to its bake, and its view submits no frame in those 60 s`, async () => {
    const [reply] = logic([bakeCall(game('on_input'), { track: [], steps: STEPS })]);
    const b = bakeOf(reply!, 'the idle bake');
    expect(ranSteps(b.steps, ID).map((s) => s.step), 'only step 0 ran: no step record, so no step hash, after it').toEqual([0]);
    expect(ranSteps(b.steps, ID)[0]!.arrays[`${ID}.ran`], 'and the program ran once').toEqual([1]);
    expect(b.ranges, 'the bake reports its array ranges').not.toBeNull();
    expect((b.ranges![ID] ?? []).filter((r) => r.step !== 0), 'no array range after step 0').toEqual([]);
    expect((b.checkpoints[ID] ?? []).map((c) => c.step), 'no checkpoint but the first, at step 0').toEqual([0]);

    const l = live();
    try {
      const v = await openView(l, game('on_input'), [], 60);
      const first = await v.frame();
      expect(first.landed.t, 'the first frame is at 0 s').toBe(0);
      expect(drawn(first.landed, `${ID}.ran`, 'the frame at 0 s'), 'it shows step 0').toEqual([1]);
      expect('valid_until' in first.landed.raw, 'the frame says how long it stays valid (valid_until)').toBe(true);
      expect(first.landed.valid_until, 'nothing on the track and no due step: valid until an entry arrives (null), so no frame is submitted').toBeNull();
      for (const [play, t] of [[30, 30], [29.9, 59.9]] as const) {
        const f = await v.frame({ play });
        expect(f.landed.t, `the playhead at ${t} s`).toBe(Math.round(t * 705_600_000));
        expect(f.steps, `no step runs up to ${t} s`).toBe(0);
        expect(f.landed.deep_hash, `the state at ${t} s is the state after step 0`).toEqual(first.landed.deep_hash);
        expect(f.landed.valid_until, `still valid until an entry arrives at ${t} s`).toBeNull();
      }
      // The contrast: with the entry on the track, the frame at 0 s is valid only until the entry runs.
      const w = await openView(l, game('on_input'), [ENTRY], 60);
      const at0 = await w.frame();
      expect(at0.landed.valid_until, 'with the entry on the track, the frame at 0 s is valid until it, at 30.008 s, or until step 1,801 runs').not.toBeNull();
      expect(at0.landed.valid_until!, 'not past step 1,801').toBeLessThanOrEqual(ENTRY_STEP * STEP_60);
      expect(at0.landed.valid_until!, 'not before the entry').toBeGreaterThanOrEqual(ENTRY_T);
    } finally { l.stop(); }
  }, TIMEOUT);

  it(`${AC[1]} an entry stamped at 30.008 s runs step 1,801, the first step at or after it, exactly once, with seed hash(document seed, logic ID, 1,801)`, () => {
    const seeds = fixedSeeds();
    expect(seeds.get(ENTRY_STEP), 'the fixed clock gives step 1,801 and step 1,802 different seeds').not.toBe(seeds.get(ENTRY_STEP + 1));
    none(judgeEntry(entryBake(), seeds), 'the turn clock on the entry\'s track');
  }, TIMEOUT);

  it(`${AC[1]} a planted module that runs the entry at the next 30 fps frame boundary (turn_runs_at_frame_boundary), step 1,802, fails, naming the entry and both steps`, () => {
    const seeds = fixedSeeds();
    none(judgeEntry(entryBake(), seeds), 'the real module on the same track');
    const planted = entryBake(['turn_runs_at_frame_boundary']);
    expect(ranSteps(planted.steps, ID).find((s) => s.arrays[`${ID}.moves`]?.[0] === 1)?.step, 'the planted module runs the entry at step 1,802').toBe(ENTRY_STEP + 1);
    failsNaming(judgeEntry(planted, seeds), /the entry at 30\.008 s \(flick 21,173,644,800, control choice, value 2\) ran at step 1,802, not step 1,801/, 'the planted module');
  }, TIMEOUT);
});

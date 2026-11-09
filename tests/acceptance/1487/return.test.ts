// AC2: on return, the first frame equals a straight evaluation at t by hash. Judged on any machine.
// The spinner is in view, panned out at 1 s (rotation 180) and back at 3.25 s (rotation 225, a different pass of
// its 2 s loop's value), so a return that redraws what the spinner showed when it left differs from the straight
// evaluation. The wrong programs: the base (its clock never stops, so nothing ever returns), and the planted
// `return_draws_stale_value`.
import { describe, expect, it } from 'vitest';
import {
  V_CARD, V_SPIN, VSYNC_60, evalFrames, fixture, presentedIn, rotZ, run, sec, secondsOf, sha256, useBinaries, visibleData, vsyncOf,
  type JsonObject, type Pan, type Vsync,
} from './helpers.ts';

useBinaries('deep-motion');

const DOC = fixture('spinner.json');
const PAN_OUT = sec(1);
const BACK = sec(3.25);
const END = sec(4.25);
const PANS: Pan[] = [{ at: PAN_OUT, rect: V_CARD }, { at: BACK, rect: V_SPIN }];

const returning = (planted?: string): Vsync[] =>
  run({ doc: DOC, to: END, mode: 'armed', view: V_SPIN, pans: PANS, ...(planted ? { planted } : {}) });

/** Null when the frame presented at `t` holds, over view V_SPIN, the same bytes as a straight evaluation at `t`. */
function hashFailure(vsyncs: readonly Vsync[], straight: JsonObject, t: number): string | null {
  const shown = vsyncs[vsyncOf(t)]!;
  if (!shown.presented) return `no frame was presented at ${secondsOf(t)}`;
  const mine = visibleData(DOC, shown.items, V_SPIN, `run at ${secondsOf(t)}`);
  const theirs = visibleData(DOC, straight['items'] as JsonObject, V_SPIN, `eval at ${secondsOf(t)}`);
  if (sha256(mine) === sha256(theirs)) return null;
  const differ = Object.keys(theirs).filter((id) => sha256(mine[id]) !== sha256(theirs[id]));
  return `at ${secondsOf(t)} the frame's hash ${sha256(mine).slice(0, 16)} is not the straight evaluation's ${sha256(theirs).slice(0, 16)}: `
    + differ.map((id) => `item ${id} shows ${JSON.stringify((mine[id] as JsonObject | undefined)?.['at'])}, eval gives ${JSON.stringify((theirs[id] as JsonObject)['at'])}`).join('; ');
}

describe('AC2 on return, the first frame equals a straight evaluation at t by hash', () => {
  it('AC2 the spinner stops the clock while out of view, the pan that brings it back arms a frame at 3.25 s, and that frame\'s visible data hashes to a straight evaluation at 3.25 s', () => {
    const vsyncs = returning();
    // A return needs the item to have left the clock: the base keeps arming one per frame, so there is none.
    const away = presentedIn(vsyncs, PAN_OUT, BACK - VSYNC_60);
    expect(away, `no frame between the pan out and the pan back (the spinner left the clock); presented at ${away.slice(0, 3).map(secondsOf).join(', ')}…`).toEqual([]);
    const [left, straight] = evalFrames(DOC, [PAN_OUT, BACK]);
    // Not vacuous: the value at t is not the value the spinner showed when it left.
    expect(rotZ(straight!['items'] as JsonObject, 'spinner', 'eval at 3.25 s'), 'straight evaluation: the spinner at 3.25 s is turned 225').toBe(225);
    expect(rotZ(left!['items'] as JsonObject, 'spinner', 'eval at 1 s'), 'straight evaluation: the spinner at 1 s, when it left, is turned 180').toBe(180);
    expect(vsyncs[vsyncOf(BACK)]!.presented, 'a pan that brings the spinner back arms a frame').toBe(true);
    expect(hashFailure(vsyncs, straight!, BACK), 'the first frame on return is the straight evaluation at t, by hash').toBeNull();
  });

  it('AC2 t stays pure: after the return every vsync presents, each frame hashing to a straight evaluation at its own t over the view', () => {
    const vsyncs = returning();
    const away = presentedIn(vsyncs, PAN_OUT, BACK - VSYNC_60);
    expect(away, 'no frame between the pan out and the pan back').toEqual([]);
    const after = vsyncs.filter((v) => v.t >= BACK);
    expect(after.filter((v) => !v.presented).map((v) => secondsOf(v.t)), 'the spinner is back in view and turning: a frame at every vsync').toEqual([]);
    const straight = evalFrames(DOC, after.map((v) => v.t));
    const failures = after.map((v, i) => hashFailure(vsyncs, straight[i]!, v.t)).filter((f) => f !== null);
    expect(failures.slice(0, 3), 'every frame after the return equals the straight evaluation at its t').toEqual([]);
  });

  it('AC2 (wrong program) the planted return_draws_stale_value, which redraws a returning item with what it showed when it left, fails the hash check naming the spinner', () => {
    const vsyncs = returning('return_draws_stale_value');
    expect(presentedIn(vsyncs, PAN_OUT, BACK - VSYNC_60), 'the planted twin still sleeps while the spinner is away').toEqual([]);
    const [straight] = evalFrames(DOC, [BACK]);
    const failure = hashFailure(vsyncs, straight!, BACK);
    expect(failure, 'the hash check fails on the planted return').not.toBeNull();
    expect(failure!, 'naming the item that came back stale').toMatch(/item spinner\b/);
  });
});

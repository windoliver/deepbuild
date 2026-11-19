// #1993.e693a7be: "A device loss forced at step 900 of the 128 × 128 run leaves the state hash at step 1,800 equal to
// an unbroken run's on that machine, and every frame before the state is rebuilt reports settling. A planted restore
// that starts from the clear value at step 900 differs at 1,800 and fails the hash line"
//
// The 128 × 128 run is criterion 1's grid (helpers.ts: waterOps): 128 × 128 cells of 1 cm, 60 steps a second, wave
// speed 0.24 m/s, one drop at its centre at step 0, held as height and rate of change in two carried `r32float`
// textures of the stepped operator `water`. It is played three times through `view3d`, each in a process of its
// own on this machine, from step 0 to step 1,800 at one frame a step (60 frames a second, so frame n shows step n);
// frame 1,800 reads both textures back (#483's `read`), and the state hash is the SHA-256 naming each one's file.
//
// 1. Unbroken. Every frame holds the state at its own step (#252's `carried.<key>.step`, for a carried texture as
//    for carried storage) and none reports settling. The state at 1,800 is finite and not the clear value.
// 2. With the device forced lost while frame 900 draws (`lose_device_at: 900`, as #377's `frames` call spells it).
//    The reply counts one loss (`device_losses: 1`). Up to the loss the frames are as the unbroken run's. From the
//    loss on, the state is rebuilt by stepping from the start (Scope), so some frames are drawn with their state
//    behind their step: there is at least one, each of them reports `settling: true`, and no frame whose state is
//    at its step does. Frame 1,800 holds step 1,800 again, and both hashes are the unbroken run's.
// 3. The same loss under `--planted restore_starts_from_clear_value`: the restore starts the state from the clear
//    value (zeros, which the step keeps at zero: the drop is step 0's alone) at step 900 and steps on. It reads a
//    state at step 1,800 whose hash differs from the unbroken run's, and the hash line fails on it, naming the hash
//    at step 1,800.
//
// At the base (9550dc0f) a stepped operator that writes a texture doesn't run, `view3d` reads past `lose_device_at`
// and no planted program has that name.
import { describe, expect, it } from 'vitest';
import {
  AC, LAST, LOST_AT, STATE, atItsStep, behind, hashProblems, named, nth, orderProblems, playCall, playOf, refusals, requireGpu, run, settlingProblems, stateAt, useBin, useOut,
  waterOps, writeWaterDoc, type Planted, type Play,
} from './helpers.ts';

const bin = useBin();
const out = useOut();

describe(`${AC} a device loss forced at step 900 of the 128 × 128 run leaves the state at step 1,800 as an unbroken run's`, () => {
  it(`${AC} the run that loses its device at step 900 has the unbroken run's state hash at step 1,800 and every frame before the state is rebuilt reports settling; a planted restore that starts from the clear value (--planted restore_starts_from_clear_value) differs at 1,800 and fails the hash line`, () => {
    requireGpu();
    const built = bin();
    expect(built.error, 'the binary builds: cargo build --locked --bin deep-gpu').toBe('');
    const dir = out();
    const ops = waterOps();
    const checked = run(built.path, dir, ops.map((operator) => ({ call: 'check_operator', operator })));
    expect(checked.refused, 'the check answers').toBe('');
    expect(refusals(ops, checked.replies), 'the 128 × 128 grid\'s operators check: carried textures, read as the previous step left them, at a ratio of 0.4').toEqual([]);
    const doc = writeWaterDoc(dir, ops, checked.replies);
    const play = (loseAt?: number, planted?: Planted): Play => {
      const ran = run(built.path, dir, [playCall(doc, loseAt)], planted);
      return ran.refused === '' ? playOf(ran.replies[0]) : { refused: ran.refused, losses: undefined, frames: [] };
    };

    // 1. The unbroken run.
    const whole = play();
    expect(whole.refused, 'the unbroken run plays').toBe('');
    expect(orderProblems(whole.frames, LAST), `the unbroken run draws frames 0 to ${nth(LAST)}`).toEqual([]);
    expect(named(behind(whole.frames)), `unbroken, every frame holds ${STATE.join(' and ')} at its own step; the frames that don't`).toBe('none');
    expect(named(whole.frames.filter((f) => f.settling)), 'unbroken, no frame reports settling; the frames that do').toBe('none');
    const wholeState = stateAt(dir, whole.frames, LAST, 'the unbroken run');
    expect(wholeState.problems, `the unbroken run's state at step ${nth(LAST)} is read and hashed`).toEqual([]);
    const height = wholeState.height ?? [];
    expect(height.length > 0 && height.every((v) => Number.isFinite(v)) && height.some((v) => v !== 0), `the unbroken height at step ${nth(LAST)} is finite in every cell and not the clear value: the drop's wave is still on the grid`).toBe(true);

    // 2. The device forced lost at step 900.
    const lost = play(LOST_AT);
    expect(lost.refused, `the run that loses its device at step ${nth(LOST_AT)} plays`).toBe('');
    expect(lost.losses, `the device was lost once (device_losses), forced at frame ${nth(LOST_AT)}`).toBe(1);
    expect(orderProblems(lost.frames, LAST, LOST_AT), `the run goes on to frame ${nth(LAST)} after the loss`).toEqual([]);
    const before = lost.frames.filter((f) => f.frame < LOST_AT);
    const after = lost.frames.filter((f) => f.frame >= LOST_AT);
    expect(named(behind(before)), 'up to the loss every frame holds the state at its own step; the frames that don\'t').toBe('none');
    expect(named(before.filter((f) => f.settling)), 'up to the loss no frame reports settling; the frames that do').toBe('none');
    const rebuilding = behind(after);
    expect(rebuilding.length, `after the loss the state is rebuilt by stepping from the start, so frames are drawn before it is rebuilt: frames from ${nth(LOST_AT)} on whose state is behind their step`).toBeGreaterThan(0);
    expect(settlingProblems(after), 'the settling line: every frame before the state is rebuilt reports settling, and no frame does once the state is at its step').toEqual([]);
    const lostState = stateAt(dir, lost.frames, LAST, 'the run that lost its device');
    expect(hashProblems(wholeState, lostState, LAST), `the hash line: the state hash at step ${nth(LAST)} equals the unbroken run's`).toEqual([]);
    const rebuilt = after.find((f) => atItsStep(f));
    console.log(`${AC}: device lost at frame ${nth(LOST_AT)}; ${rebuilding.length} frames reported settling (${named(rebuilding)}); the state was at its step again from frame ${nth(rebuilt?.frame ?? -1)}; at step ${nth(LAST)} ${STATE.map((k) => `${k} ${lostState.hashes.get(k) ?? 'unread'}`).join(', ')}, as unbroken`);

    // 3. The planted restore, judged by the same hash line.
    const twin = play(LOST_AT, 'restore_starts_from_clear_value');
    expect(twin.refused, 'the planted restore plays (--planted restore_starts_from_clear_value)').toBe('');
    expect(twin.losses, 'the planted run lost its device once too').toBe(1);
    const twinState = stateAt(dir, twin.frames, LAST, 'the planted restore');
    expect(twinState.problems, `the planted restore reaches step ${nth(LAST)} with a state to hash`).toEqual([]);
    const failure = hashProblems(wholeState, twinState, LAST);
    expect(failure.length, 'the planted restore fails the hash line').toBeGreaterThan(0);
    expect(failure.join('\n'), `the planted restore's failure names the hash at step ${nth(LAST)}`).toContain(`the state hash at step ${nth(LAST)} differs from the unbroken run's`);
    console.log(`${AC}: planted restore_starts_from_clear_value: ${failure.join('; ')}`);
  }, 3_600_000);
});

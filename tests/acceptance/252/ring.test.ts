// #252.1d7d5564: "With its checkpoint budget forced to 20 checkpoints' bytes, the ring stays within it, and a seek
// renders within the class's seek time; a planted ring that keeps every checkpoint passes the budget and fails,
// naming the operator"
//
// The flock (helpers.ts: flockOps) with its ring's budget forced to 20 of its checkpoints' bytes, 20 × 3,145,728 =
// 62,914,560 (a checkpoint's bytes are its carried storage's: 262,144 boids × 3 f32). Played at 60 Hz to step 3,600
// through `view3d`, every frame's `carried.flock.state.ring` holds at most that many bytes and names that budget.
// Checkpoints every 60 steps would be 61 by step 3,600; the design doubles the spacing each time the ring passes its
// budget (Carried state; Checkpoint ring; Logic: checkpoints and bake), to 120 (31) and then 240 (16), so at step
// 3,600 no two held checkpoints, nor the start and the first, are more than 240 steps apart. The seek back to 1,800
// restores the nearest held checkpoint at or before it (1,680 when the ring is as the design thins it) and steps the
// rest, and its state hashes as the played step 1,800's.
//
// The class's seek time. The design names none; it says a seek that needs more steps than fit in a frame runs them
// across frames "within the budget class's worker time each frame" (Carried state), and a restore is O(steps since
// the checkpoint). Here, as in exports, checks and goldens, view3d runs on the virtual clock and waits for every
// step, so the sought frame is one frame holding the restore, the steps and the draw. Its bound: at most 239 steps
// (the forced ring's spacing, 240, less one), each within what one fixed step may take in play, plus one frame. The
// document is a showpiece (its passes draw at full resolution, past a figure's half); a showpiece's operators get
// 4 ms of GPU time a frame (Operator budgets by class), and a 30 Hz frame, the class's ambient cap and the slowest
// rate criterion 1 plays, holds two 60 Hz steps, so a step may take 2 ms; a showpiece frame takes 10 ms (Budget
// class table, Frame GPU). So the sought frame's wall time (`wall_ms`, README) is within 239 × 2 + 10 = 488 ms,
// judged as every timing is (Numbers version 0 has to hold: Every task carries its own budgets): on a reference Mac,
// five seeks after a warm-up one, PASS when all five are within, FAIL when all five are over by more than the margin
// on a machine whose one-minute load is at most 1 a core, otherwise INCONCLUSIVE. Each seek's state hashes as the
// played step 1,800's, so a fast wrong seek can't pass.
//
// The planted `ring_keeps_every_checkpoint` keeps a checkpoint every 60 steps and never thins: by step 3,600 its ring
// holds 61 × 3,145,728 bytes, past the budget, and the failure names the operator. At the base no operator steps.
import { describe, expect, it } from 'vitest';
import {
  AC, CHECKPOINT_BYTES, FLOCK_STATE, FORCED_RING, carriedOn, failsNaming, flockDoc, framesNumbered, judge, requireGpu, requireReferenceMac, run, stateOf,
  useBin, useOut, view3dCall, view3dFrames, type JsonObject, type Planted, type V3Frame,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const STEP = 1800;
const LAST = 3600;
/** The forced ring's spacing: 60 doubled until 3,600 steps' checkpoints fit 20. */
const SPACING = 240;
/** The showpiece's seek time for this ring (above): 239 steps at 2 ms and one 10 ms frame. */
const SEEK_MS = (SPACING - 1) * 2 + 10;

/** Every frame's ring within its budget; each problem names the operator. */
function ringProblems(frames: V3Frame[]): string[] {
  const p: string[] = [];
  for (const f of frames) {
    const c = carriedOn(f, FLOCK_STATE, 'the forced ring');
    if (c.budget !== FORCED_RING) { p.push(`operator flock's ring (flock.state) names budget ${c.budget} at frame ${f.frame}, not the forced ${FORCED_RING}`); break; }
    if (c.ringBytes > FORCED_RING) { p.push(`operator flock's ring (flock.state) holds ${c.ringBytes} bytes (${c.checkpoints.length} checkpoints) at frame ${f.frame}, step ${c.step}, past its budget of ${FORCED_RING}`); break; }
  }
  return p;
}
const play = (planted: Planted | undefined, extra: JsonObject): { dir: string; frames: V3Frame[] } => {
  const dir = out();
  const doc = flockDoc(bin(), dir, FORCED_RING);
  const [r] = run(bin(), dir, [view3dCall({ doc, fps: 60, ...extra })], planted);
  return { dir, frames: view3dFrames(r!, 'the flock with its ring forced to 20 checkpoints') };
};

describe(`${AC[2]} the checkpoint ring stays within a forced budget, and a seek renders within the class's seek time`, () => {
  it(`${AC[2]} forced to 20 checkpoints' bytes, the ring stays within them every frame, thins to every 240 steps, and the seek to 1,800 restores its nearest checkpoint and equals the play`, () => {
    requireGpu();
    const { dir, frames } = play(undefined, { frames: LAST + 2, seeks: [{ after: LAST, to: STEP }], capture: [STEP], read: [FLOCK_STATE] });
    expect(ringProblems(frames), 'the ring within its forced budget').toEqual([]);
    const atLast = frames.find((f) => f.frame === LAST)!;
    const held = carriedOn(atLast, FLOCK_STATE, 'the play').checkpoints;
    expect(held.length, `the ring holds checkpoints at step ${LAST}`).toBeGreaterThan(0);
    expect(held.every((s) => Number.isInteger(s) && s >= 0 && s <= LAST), `each held checkpoint is a step of the play: ${held.join(', ')}`).toBe(true);
    const marks = [...new Set([0, ...held, LAST])].sort((a, b) => a - b);
    const gaps = marks.slice(1).map((s, i) => s - marks[i]!);
    expect(Math.max(...gaps), `held checkpoints at step ${LAST} are at most ${SPACING} steps apart, as the doubling spacing leaves them: ${held.join(', ')}`).toBeLessThanOrEqual(SPACING);
    const [played, sought] = framesNumbered(frames, STEP);
    expect(sought, `the seek drew frame ${STEP}`).toBeDefined();
    const restored = carriedOn(sought!, FLOCK_STATE, 'the seek').restored;
    const nearest = Math.max(...held.filter((s) => s <= STEP));
    expect(restored, `the seek to ${STEP} restored a checkpoint`).not.toBeNull();
    expect(restored, `the seek restored the nearest held checkpoint at or before ${STEP} and stepped the rest`).toEqual({ from: nearest, steps: STEP - nearest });
    expect(stateOf(dir, sought!, 'the seek').hash, `the seek's state at step ${STEP} hashes as the play's`).toBe(stateOf(dir, played!, 'the play').hash);
  }, 3_600_000);

  it(`${AC[2]} the seek to 1,800 renders within the showpiece's seek time for this ring, ${SEEK_MS} ms (five seeks after a warm-up)`, () => {
    requireReferenceMac();
    // Six seeks to 1,800, each after a step the session hasn't drawn yet (seeks match the first frame drawn with that
    // number): 0 … 3,600, then 1,800 … 3,600 + i for i = 1 … 5, then 1,800.
    const seeks = Array.from({ length: 6 }, (_, i) => ({ after: LAST + i, to: STEP }));
    const frames = LAST + 1 + Array.from({ length: 5 }, (_, i) => LAST + i + 1 - STEP + 1).reduce((a, b) => a + b, 0) + 1;
    const { dir, frames: drawn } = play(undefined, { frames, seeks, capture: [STEP], read: [FLOCK_STATE], timings: true });
    expect(ringProblems(drawn), 'the ring within its forced budget').toEqual([]);
    const [played, ...sought] = framesNumbered(drawn, STEP);
    expect(sought.length, 'six seeks to 1,800').toBe(6);
    const want = stateOf(dir, played!, 'the play').hash;
    sought.forEach((f, i) => expect(stateOf(dir, f, `seek ${i + 1}`).hash, `seek ${i + 1}'s state at step ${STEP} hashes as the play's`).toBe(want));
    const runs = sought.slice(1).map((f, i) => {
      expect(f.wallMs, `seek ${i + 2} reports its frame's wall_ms`).not.toBeNull();
      return f.wallMs!;
    });
    judge(`the seek to step ${STEP} with the ring at ${FORCED_RING / CHECKPOINT_BYTES} checkpoints, the sought frame's wall ms`, runs, SEEK_MS);
  }, 3_600_000);

  it(`${AC[2]} a planted ring that keeps every checkpoint (--planted ring_keeps_every_checkpoint) passes the budget and fails, naming the operator`, () => {
    requireGpu();
    const { frames } = play('ring_keeps_every_checkpoint', { frames: LAST + 1 });
    failsNaming(ringProblems(frames), ['operator flock', 'past its budget'], 'the planted ring_keeps_every_checkpoint');
  }, 3_600_000);
});

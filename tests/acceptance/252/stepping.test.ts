// #252.e326cc65: "A flock of 262,144 boids stepped 3,600 steps, then seeked to step 1,800, equals the played run at
// step 1,800 by hash on one machine; a planted operator that steps per frame instead of per fixed step differs at 30
// and 144 Hz and fails, naming the step"
//
// The flock (helpers.ts: flockOps) steps at a fixed 60 steps a second, so step 1,800 is t = 30 s: frame 1,800 at
// 60 Hz, frame 900 at 30 Hz and frame 4,320 at 144 Hz. Its ring is the design's defaults (Checkpoint ring: every 60
// steps, 16 MiB), which hold 5 of its 3 MiB checkpoints, so the ring thins to every 960 steps and the seek restores
// step 960 and steps 840 forward. Through #378's `view3d` with #483's `read` of the flock's carried storage
// (`flock.state`) and #484's `seeks`: played at 60 Hz to step 3,600, then seeked back to 1,800 in the same session;
// played at 30 Hz and at 144 Hz to step 1,800; and a cold session opened at 1,800 (#380's `from`). The state's
// SHA-256 (its read file's name) is the same in all five, each frame reports `carried.flock.state.step` 1,800, and
// the played state is a flock that moved since step 1,799 (helpers.ts: flockProblems), so equal empty states can't
// pass. The planted `steps_per_frame` steps once a frame: at 30 Hz frame 900 holds step 900's flock and at 144 Hz
// frame 4,320 step 4,320's, so each differs from the 60 Hz play, and the failure names step 1,800 and the rate. At
// the base an operator has no `stepped` field (refused as not a field of an operator) and view3d no `carried`.
import { describe, expect, it } from 'vitest';
import {
  AC, DEFAULT_RING, FLOCK_STATE, carriedOn, failsNaming, flockDoc, flockProblems, framesNumbered, requireGpu, run, stateOf, useBin, useOut,
  view3dCall, view3dFrames, type Planted, type V3Frame,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const STEP = 1800;

/** The played 60 Hz run's state at STEP, and the problems of every other way of reaching it, each naming the step. */
function stepProblems(planted?: Planted): string[] {
  const dir = out();
  const doc = flockDoc(bin(), dir, DEFAULT_RING);
  const read = [FLOCK_STATE];
  const calls = [
    view3dCall({ doc, fps: 60, frames: 3602, seeks: [{ after: 3600, to: STEP }], capture: [STEP - 1, STEP], read }),
    view3dCall({ doc, fps: 30, frames: 901, capture: [900], read }),
    view3dCall({ doc, fps: 144, frames: 4321, capture: [4320], read }),
    view3dCall({ doc, fps: 60, from: STEP, frames: 1, capture: [STEP], read }),
  ];
  const [sixty, thirty, fast, cold] = run(bin(), dir, calls, planted).map((r, i) => view3dFrames(r, ['the 60 Hz play and seek', 'the 30 Hz play', 'the 144 Hz play', 'the cold seek'][i]!));
  const [played, sought] = framesNumbered(sixty!, STEP);
  expect(played, `the 60 Hz play drew frame ${STEP}`).toBeDefined();
  expect(sought, `the seek from step 3,600 drew frame ${STEP} again`).toBeDefined();
  const before = framesNumbered(sixty!, STEP - 1)[0];
  expect(before, `the 60 Hz play drew frame ${STEP - 1}`).toBeDefined();
  const want = stateOf(dir, played!, 'the 60 Hz play');
  const problems = flockProblems(want, stateOf(dir, before!, 'the 60 Hz play'), `the 60 Hz play at step ${STEP}`);
  const way = (what: string, f: V3Frame | undefined): void => {
    expect(f, `${what} drew its frame`).toBeDefined();
    const got = stateOf(dir, f!, what);
    if (got.hash !== want.hash) problems.push(`at step ${STEP}, ${what} (frame ${f!.frame}) hashes ${got.hash}, the 60 Hz play ${want.hash}`);
    const c = carriedOn(f!, FLOCK_STATE, what);
    if (c.step !== STEP) problems.push(`at step ${STEP}, ${what} (frame ${f!.frame}) reports the flock at step ${c.step}`);
  };
  way('the seek from step 3,600', sought);
  way('the flock played at 30 Hz', framesNumbered(thirty!, 900)[0]);
  way('the flock played at 144 Hz', framesNumbered(fast!, 4320)[0]);
  way('a cold session opened at step 1,800', cold!.find((f) => f.frame === STEP));
  return problems;
}

describe(`${AC[1]} a stepped flock's seek equals its play, at any frame rate`, () => {
  it(`${AC[1]} the flock of 262,144 boids stepped to 3,600 and seeked to 1,800, played at 30 and 144 Hz, and opened cold at 1,800, has the 60 Hz play's hash at step 1,800`, () => {
    requireGpu();
    expect(stepProblems()).toEqual([]);
  }, 3_600_000);

  it(`${AC[1]} a planted operator that steps per frame (--planted steps_per_frame) differs at 30 and 144 Hz and fails, naming the step`, () => {
    requireGpu();
    const problems = stepProblems('steps_per_frame');
    failsNaming(problems, [`at step ${STEP}, the flock played at 30 Hz (frame 900) hashes`, `at step ${STEP}, the flock played at 144 Hz (frame 4320) hashes`], 'the planted steps_per_frame');
  }, 3_600_000);
});

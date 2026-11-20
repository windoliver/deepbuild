// #1993.cef70375: "A 512 × 512 grid takes 20 drops from a recorded input track over 20 s. Seeking back to 7.5 s gives
// the state hash that play had at 7.5 s, and replaying the track gives the played hash at every checkpoint, on one
// machine. A planted step that reads the live pointer differs on replay and fails the replay line, naming the first
// checkpoint that differs"
//
// The pond (helpers.ts: pondOps, pondDoc) is a 512 × 512 height grid and its velocity, two carried r32float textures
// of one operator stepped 60 times a second, read back with `step: previous`. Its pointer is three controls of the
// document, and the recorded track (dropTrack) holds 20 drops, drop k at k + 0.25 s: the pointer moves to the drop's
// cell and goes down for the one step at 60k + 15. Each texture's ring takes a checkpoint every 60 steps and keeps
// all 21 of the run, one at each whole second.
//
// The play is `view3d` at 60 frames a second with the track, steps 0 to 1,200, then a seek back to frame 450 (7.5 s,
// step 450, half a second past checkpoint 420, so the seek steps through the drop at 7.25 s again). The replay is a
// second session given the same track and drawn at 30 frames a second, two steps a frame (README: Readings). Each
// state is the two textures as `read` wrote them, and its hash is their files' SHA-256s.
//
// - Takes 20 drops: walls reflect and nothing damps, so the summed height is the volume of the drops landed so far
//   (helpers.ts: pondOps); at every checkpoint and at 7.5 s it is within half a drop of 0, 1, … 20 and of 8.
// - The seek line: the frame the seek drew hashes as the played frame 450, at step 450.
// - The replay line: at every checkpoint the replay hashes as the play; a failure names the first that differs.
//
// The planted `step_reads_live_pointer` reads the pointer as it stands when the frame is drawn, for every step that
// frame runs, in place of each step's own entries. At 60 frames a second that is the same pointer; at 30 the frame
// that runs step 60k + 15 is drawn at step 60k + 16, when the pointer is up again, so the replay takes no drop and
// differs from the play from the first drop on: first at checkpoint 1 (step 60, 1 s).
//
// At the base nothing is carried in a texture: a stepped operator reads and writes storage only, so no frame reports
// a carried row for the pond, and the planted name is unknown.
import { describe, expect, it } from 'vitest';
import {
  AC, DROPS, POND, POND_CHECKPOINTS, POND_HEIGHT, POND_RATE, POND_STEPS, POND_VELOCITY, carriedProblems, dropAt, dropTrack, dropVolume, dropsBy,
  framesNumbered, pondDoc, requireGpu, run, stateOf, total, useBin, useOut, view3dCall, viewOf, type Planted, type View,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const KEYS: [string, string] = [POND_HEIGHT, POND_VELOCITY];
/** 7.5 s: step and, at 60 frames a second, frame 450. */
const SEEK_STEP = 7.5 * POND_RATE;
/** The replay's frames a second, half the play's, so a frame runs two steps. */
const REPLAY_FPS = 30;
const REPLAY_FRAME = (step: number): number => step * REPLAY_FPS / POND_RATE;

interface Runs { refusal: string; dir: string; play: View; replay: View }
/** The pond played at 60 frames a second and sought back to 7.5 s, and the track replayed at 30, each under the same program. */
function playAndReplay(planted?: Planted): Runs {
  const dir = out();
  const none: View = { frames: [], refusal: '' };
  const doc = pondDoc(bin(), dir);
  if (doc.refusal !== '') return { refusal: doc.refusal, dir, play: none, replay: none };
  const track = dropTrack();
  const session = run(bin(), dir, [
    view3dCall({ doc: doc.path, fps: POND_RATE, frames: POND_STEPS + 2, track, seeks: [{ after: POND_STEPS, to: SEEK_STEP }], capture: [...POND_CHECKPOINTS, SEEK_STEP], read: KEYS }),
    view3dCall({ doc: doc.path, fps: REPLAY_FPS, frames: REPLAY_FRAME(POND_STEPS) + 1, track, capture: POND_CHECKPOINTS.map(REPLAY_FRAME), read: KEYS }),
  ], planted);
  const play = viewOf(session.replies[0], 'the play');
  const replay = viewOf(session.replies[1], 'the replay');
  return { refusal: session.refusal || play.refusal || replay.refusal, dir, play, replay };
}

/** Takes 20 drops: the play's summed height at each checkpoint and at 7.5 s, against the volume of the drops landed by then. */
function dropProblems(r: Runs): string[] {
  const volumes = Array.from({ length: DROPS }, (_, k) => dropVolume(dropAt(k)));
  const problems: string[] = [];
  for (const s of [...POND_CHECKPOINTS, SEEK_STEP]) {
    const landed = dropsBy(s);
    const at = stateOf(r.dir, framesNumbered(r.play, s)[0], KEYS, POND, `the play at step ${s}`);
    if (at.state === null) return [at.problem];
    const held = total(at.state.first);
    const want = volumes.slice(0, landed).reduce((a, b) => a + b, 0);
    if (!(Math.abs(held - want) < 0.5 * volumes[0]!)) problems.push(`at step ${s} the pond's summed height is ${held} m, ${(held / volumes[0]!).toFixed(3)} drops' volume, not that of the ${landed} drops the track landed by then (${want} m)`);
  }
  return problems;
}

/** The seek line: the frame the seek drew at 7.5 s hashes as the frame the play drew there, and holds step 450. */
function seekProblems(r: Runs): string[] {
  const [played, sought] = framesNumbered(r.play, SEEK_STEP);
  const before = stateOf(r.dir, played, KEYS, POND, 'the play at 7.5 s');
  if (before.state === null) return [before.problem];
  const after = stateOf(r.dir, sought, KEYS, POND, 'the seek back to 7.5 s');
  if (after.state === null) return [after.problem];
  const problems: string[] = [];
  if (after.state.hash !== before.state.hash) problems.push(`the seek back to 7.5 s (step ${SEEK_STEP}) hashes ${after.state.hash}, the play at 7.5 s ${before.state.hash}`);
  for (const key of KEYS) if (sought!.carried.get(key)?.step !== SEEK_STEP) problems.push(`the seek back to 7.5 s reports ${key} at step ${String(sought!.carried.get(key)?.step)}, not ${SEEK_STEP}`);
  return problems;
}

/** The replay line: the replay's state at every checkpoint hashes as the play's; a failure names the first checkpoint that differs. */
function replayProblems(r: Runs): string[] {
  for (const [k, s] of POND_CHECKPOINTS.entries()) {
    const played = stateOf(r.dir, framesNumbered(r.play, s)[0], KEYS, POND, `the play at checkpoint ${k} (step ${s})`);
    if (played.state === null) return [played.problem];
    const replayed = stateOf(r.dir, framesNumbered(r.replay, REPLAY_FRAME(s))[0], KEYS, POND, `the replay at checkpoint ${k} (step ${s})`);
    if (replayed.state === null) return [replayed.problem];
    if (replayed.state.hash !== played.state.hash) return [`the replay differs from the play first at checkpoint ${k} (step ${s}, ${k} s): it hashes ${replayed.state.hash}, the play ${played.state.hash}`];
  }
  return [];
}

describe(`${AC[3]} a pond takes its drops from the input track, so a seek and a replay give the play's state`, () => {
  it(`${AC[3]} a 512 × 512 grid takes 20 drops from a recorded input track over 20 s; seeking back to 7.5 s gives the hash play had at 7.5 s, and replaying the track gives the played hash at every checkpoint`, () => {
    requireGpu();
    const r = playAndReplay();
    expect(r.refusal, 'the pond played, sought and replayed').toBe('');
    expect(carriedProblems(r.play, KEYS, 'the play'), 'every frame of the play reports the pond\'s two carried textures').toEqual([]);
    expect(carriedProblems(r.replay, KEYS, 'the replay'), 'every frame of the replay reports the pond\'s two carried textures').toEqual([]);

    // 20 s of play: step 1,200, with a checkpoint of both textures at each whole second.
    const last = framesNumbered(r.play, POND_STEPS)[0];
    expect(last, `the play drew frame ${POND_STEPS}`).toBeDefined();
    for (const key of KEYS) {
      expect(last!.carried.get(key)!.step, `the play's frame ${POND_STEPS} holds ${key} at step ${POND_STEPS}`).toBe(POND_STEPS);
      expect(last!.carried.get(key)!.checkpoints, `${key}'s ring holds a checkpoint every 60 steps of the play`).toEqual(POND_CHECKPOINTS);
    }
    expect(dropProblems(r), 'the pond holds the volume of the drops the track landed, 20 by the end').toEqual([]);

    // The seek restores the checkpoint at 7 s and steps the half second after it, through the drop at 7.25 s.
    const sought = framesNumbered(r.play, SEEK_STEP)[1];
    expect(sought, `the seek drew frame ${SEEK_STEP} again`).toBeDefined();
    for (const key of KEYS) expect(sought!.carried.get(key)!.restored, `the seek restored ${key}'s checkpoint at step 420 and stepped 30`).toEqual({ from: 420, steps: 30 });
    expect(seekProblems(r), 'the seek line').toEqual([]);

    for (const s of POND_CHECKPOINTS) for (const key of KEYS) expect(framesNumbered(r.replay, REPLAY_FRAME(s))[0]?.carried.get(key)?.step, `the replay's frame ${REPLAY_FRAME(s)} holds ${key} at step ${s}`).toBe(s);
    expect(replayProblems(r), 'the replay line').toEqual([]);
  }, 1_800_000);

  it(`${AC[3]} a planted step that reads the live pointer (--planted step_reads_live_pointer) differs on replay and fails the replay line, naming the first checkpoint that differs`, () => {
    requireGpu();
    const r = playAndReplay('step_reads_live_pointer');
    expect(r.refusal, 'the planted step_reads_live_pointer played and replayed the pond').toBe('');
    const problems = replayProblems(r);
    expect(problems.length, 'the planted step_reads_live_pointer fails the replay line').toBeGreaterThan(0);
    // The first drop lands at 0.25 s, so the first checkpoint a replay without it can differ at is the one at 1 s.
    expect(problems.join('\n'), 'the failure names the first checkpoint that differs').toContain('the replay differs from the play first at checkpoint 1 (step 60, 1 s)');
  }, 1_800_000);
});

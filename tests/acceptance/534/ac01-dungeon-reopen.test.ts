// Criterion 1: "A dungeon piece whose logic keeps its floor, health, inventory and the state of its seeded generator,
// saved at step 1,800 in the app, the app quit and the piece opened again from that save, then fed the same next 600
// steps of recorded input, gives the same full-state hashes at each checkpoint and the same frames, bit for bit on the
// reference Mac, as a run that never quit; a planted save that leaves out the logic's globals, and one that leaves out
// the input position, each fail that comparison, naming the first checkpoint that differs"
//
// Through `deep-logic` (README: deep-logic): a `bake` with a `saves_dir` writes the dungeon's saves (its logic asks
// for slot 1 at the ends of steps 1,199 and 1,799) and the process exits: the app quit. A second process opens the
// slot (`open_save`) and plays the same track on to step 2,400; a third bakes the never-quit run of 2,400 steps. The
// track has a burst of 40 moves at step 1,798, so 8 are still unread when the save at 1,800 is written: its input
// position is more than its step. The frames leg is pinned to the reference Mac and is BLOCKED elsewhere.
import { describe, expect, it } from 'vitest';
import { AC, STEP_60, TIMEOUT, bakeCall, bakeOf, firstCheckpointDiff, firstDiff, firstFrameDiff, logicBin, onReferenceMacOnly, openSaveCall, openedOf, prebuild, rows, run, savesDir, type Bake, type FrameSpan, type Opened, type Planted, type SaveWritten } from './helpers.ts';
import { DUNGEON, dungeonPiece, dungeonTrack } from './dungeon.ts';

prebuild(() => { logicBin(); });

const SAVED_AT = 1800;
const END = 2400;
const EVERY = 60;
const FRAMES: FrameSpan[] = [{ from: (SAVED_AT - 1) * STEP_60, count: END - SAVED_AT + 1, arrays: [`${DUNGEON}.floor`, `${DUNGEON}.health`, `${DUNGEON}.inv`] }];

/** Saves in one process (which then exits), opens the newest save of slot 1 in another. */
function saveQuitOpen(planted: Planted[] = [], frames?: FrameSpan[]): { saves: SaveWritten[]; opened: Opened } {
  const dir = savesDir();
  const [saving] = run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: dir })], planted);
  const saves = bakeOf(saving!, `the bake that saves${planted.length ? ` (${planted.join(', ')})` : ''}`).saves;
  const [open] = run([openSaveCall(dungeonPiece(), { saves_dir: dir, slot: 1, track: dungeonTrack(), steps: END, ...(frames ? { frames } : {}) })], planted);
  return { saves, opened: openedOf(open!, `open_save of slot 1${planted.length ? ` (${planted.join(', ')})` : ''}`) };
}
let neverQuitRun: Bake | undefined;
function neverQuit(frames?: FrameSpan[]): Bake {
  if (frames) return bakeOf(run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: END, frames })])[0]!, 'the never-quit run');
  neverQuitRun ??= bakeOf(run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: END })])[0]!, 'the never-quit run');
  return neverQuitRun;
}
/** The criterion's comparison by full-state hash: a message naming the first checkpoint that differs, or null. */
function compare(opened: Opened, nq: Bake): string | null {
  const d = firstCheckpointDiff(opened.checkpoints, nq.checkpoints, SAVED_AT);
  return d ? `the reopened run differs from the never-quit run first at checkpoint ${d.step} (${d.item}: ${d.got} against ${d.want ?? 'none'})` : null;
}

describe(`${AC[1]} the dungeon saved at step 1,800, quit and reopened plays on as a run that never quit`, () => {
  it(`${AC[1]} saved at 1,800, the app quit and reopened, the next 600 steps give the never-quit run's full-state hash at every checkpoint, its step hashes and its arrays`, () => {
    const { saves, opened } = saveQuitOpen();
    expect(saves.map((s) => [s.item, s.slot, s.step]), 'the logic asked for slot 1 at the ends of steps 1,199 and 1,799').toEqual([[DUNGEON, 1, 1200], [DUNGEON, 1, SAVED_AT]]);
    const save = saves[1]!;
    expect([opened.hash, opened.step, opened.via], 'the newest save of slot 1 opens, straight, at step 1,800').toEqual([save.hash, SAVED_AT, 'straight']);
    const nq = neverQuit();
    const at1800 = nq.checkpoints[DUNGEON]?.find((c) => c.step === SAVED_AT)?.deep_hash;
    expect(opened.deep_hash[DUNGEON], 'the opened state has the full-state hash the save recorded').toBe(save.deep_hash[DUNGEON]);
    expect(opened.deep_hash[DUNGEON], 'which is the never-quit run\'s at checkpoint 1,800').toBe(at1800);
    expect(opened.checkpoints[DUNGEON]?.map((c) => c.step), 'the reopened run reports the opened state and every checkpoint to step 2,400').toEqual(Array.from({ length: (END - SAVED_AT) / EVERY + 1 }, (_, i) => SAVED_AT + i * EVERY));
    expect(compare(opened, nq), 'every checkpoint\'s full-state hash equals the never-quit run\'s').toBeNull();
    expect(firstDiff(rows(opened.steps), rows(nq.steps.filter((s) => s.step >= SAVED_AT))), 'steps 1,800 to 2,399 give the never-quit run\'s step hashes and arrays').toBeNull();
  }, TIMEOUT);

  for (const [planted, what, latest] of [
    ['save_drops_globals', 'leaves out the logic\'s globals', SAVED_AT],
    ['save_drops_input_position', 'leaves out the input position', SAVED_AT + EVERY],
  ] as const) {
    it(`${AC[1]} a planted save that ${what} (${planted}) fails the comparison, naming the first checkpoint that differs`, () => {
      const { opened } = saveQuitOpen([planted]);
      const nq = neverQuit();
      const d = firstCheckpointDiff(opened.checkpoints, nq.checkpoints, SAVED_AT);
      expect(d, `the planted save (${planted}) fails the never-quit comparison by full-state hash`).not.toBeNull();
      expect(compare(opened, nq), 'and the comparison names that checkpoint').toContain(`checkpoint ${d!.step}`);
      expect(d!.step, `the first checkpoint that differs is at or before ${latest}: ${JSON.stringify(d)}`).toBeLessThanOrEqual(latest);
    }, TIMEOUT);
  }

  it(`${AC[1]} on the reference Mac, the reopened run's frames for the next 600 steps equal the never-quit run's bit for bit`, () => {
    onReferenceMacOnly('criterion 1\'s frames, bit for bit');
    const { opened } = saveQuitOpen([], FRAMES);
    const nq = neverQuit(FRAMES);
    expect(opened.frames[0]?.length, 'the reopened run gives a frame a step from the saved state on').toBe(FRAMES[0]!.count);
    expect(firstFrameDiff(opened.frames[0]!, nq.frames[0]!), 'every frame equals the never-quit run\'s, bit for bit').toBeNull();
    expect(compare(opened, nq), 'and every checkpoint\'s full-state hash').toBeNull();
  }, TIMEOUT);
});

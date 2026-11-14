// Criterion 5: "A dungeon that keeps its floor in an initialized static, so in an active data segment, saved at step
// 1,800 and opened under the same program, matches the never-quit run by full-state hash at every checkpoint; a
// planted open that re-applies the program's segments fails, naming the first checkpoint that differs; and opened
// under a changed program, that save is refused without a migration, naming the segment and the first offset"
//
// Through `deep-logic` (README: deep-logic). `dungeon_static` (programs.ts) keeps its floor in the first word of its
// one active data segment (segment 0, at byte 1024, initially 1) and goes down a floor every 300 steps, so at step
// 1,800 the save's floor is 7: the segment's first byte differs from the segment's own. It saves slot 1 at step 1,800.
// `open_reapplies_segments` writes the program's active segments over the save's pages when it opens.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, firstCheckpointDiff, firstDiff, layoutFor, logicBin, openSaveCall, openedOf, piece, prebuild, refusalOf, rows, run, savesDir, type Bake, type JsonObject, type Planted } from './helpers.ts';
import { STATIC_FLOOR_AT, STATIC_WRITES, dungeonStatic, layoutProbe } from './programs.ts';

prebuild(() => { logicBin(); });

const ID = 'keep';
const SAVED_AT = 1800;
const END = 2400;
function staticPiece(variant: 'same' | 'nop' = 'same'): JsonObject {
  const l = layoutFor(layoutProbe(), [], STATIC_WRITES);
  return piece({ seed: 534_05, items: { [ID]: { program: dungeonStatic(l, variant), writes: STATIC_WRITES, saves: { slots: 1, request: 'request' } } } });
}
function save(planted: Planted[] = []): string {
  const dir = savesDir();
  const b = bakeOf(run([bakeCall(staticPiece(), { steps: SAVED_AT, saves_dir: dir })], planted)[0]!, 'the bake that saves');
  expect(b.saves.map((s) => s.step), 'slot 1 is saved at step 1,800').toEqual([SAVED_AT]);
  expect(b.steps.at(-1)?.arrays[`${ID}.floor`], 'the floor in the static is 7 by then').toEqual([7]);
  return dir;
}
let nqRun: Bake | undefined;
const neverQuit = (): Bake => (nqRun ??= bakeOf(run([bakeCall(staticPiece(), { steps: END })])[0]!, 'the never-quit run'));

describe(`${AC[5]} a floor kept in an active data segment: saved, reopened, and refused under a changed program`, () => {
  it(`${AC[5]} saved at 1,800 and opened under the same program, it matches the never-quit run by full-state hash at every checkpoint`, () => {
    const dir = save();
    const o = openedOf(run([openSaveCall(staticPiece(), { saves_dir: dir, slot: 1, steps: END })])[0]!, 'open_save under the same program');
    expect([o.step, o.via], 'it opens straight at step 1,800').toEqual([SAVED_AT, 'straight']);
    const nq = neverQuit();
    expect(firstCheckpointDiff(o.checkpoints, nq.checkpoints, SAVED_AT), 'every checkpoint from 1,800 to 2,400 has the never-quit run\'s full-state hash').toBeNull();
    expect(o.checkpoints[ID]?.length, 'the opened state and 10 checkpoints after it').toBe(11);
    expect(firstDiff(rows(o.steps), rows(nq.steps.filter((s) => s.step >= SAVED_AT))), 'and every step\'s hash and arrays').toBeNull();
  }, TIMEOUT);

  it(`${AC[5]} a planted open that re-applies the program's segments (open_reapplies_segments) fails, naming the first checkpoint that differs`, () => {
    const dir = save();
    const o = openedOf(run([openSaveCall(staticPiece(), { saves_dir: dir, slot: 1, steps: END })], ['open_reapplies_segments'])[0]!, 'open_save with open_reapplies_segments');
    const d = firstCheckpointDiff(o.checkpoints, neverQuit().checkpoints, SAVED_AT);
    expect(d, 'the planted open fails the never-quit comparison by full-state hash').not.toBeNull();
    expect(d!.step, `naming checkpoint 1,800, the opened state, whose floor went back to 1: ${JSON.stringify(d)}`).toBe(SAVED_AT);
    expect(o.steps[0]?.arrays[`${ID}.floor`], 'its first step shows the segment\'s floor, not the saved one').toEqual([1]);
  }, TIMEOUT);

  it(`${AC[5]} opened under a changed program with no migration, the save is refused, naming the segment and the first offset`, () => {
    const dir = save();
    const r = refusalOf(run([openSaveCall(staticPiece('nop'), { saves_dir: dir, slot: 1, steps: END })])[0]!, 'open_save under the changed program');
    expect(r.code, 'refused').toBe('save_refused');
    const seg = r.differs.find((d) => d.what === 'segment');
    expect(seg, `naming the segment whose saved bytes differ from its own: ${JSON.stringify(r.differs)}`).toBeDefined();
    expect([seg!.segment, seg!.offset], `segment 0, first at byte ${STATIC_FLOOR_AT} (the floor)`).toEqual([0, STATIC_FLOOR_AT]);
    expect(r.damaged, 'nothing reads as damaged').toEqual([]);
  }, TIMEOUT);
});

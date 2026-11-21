// Criterion 1: "A dungeon piece whose program exports a state layout, saved at step 1,800, opens straight after a fix
// that changes only its damage formula and keeps the layout, with its roster, gold and floor as they were saved; the
// same save, after a change that inserts a field before the roster and exports a new layout, is refused without a
// migration, naming both layouts"
//
// Through `deep-logic` (README: deep-logic). The dungeon (programs.ts) exports the layout V1 at `layout_at` and saves
// slot 1 at step 1,800; the process exits. Under `fix` (the damage formula's attack × 2, the same layout bytes) another
// process opens it: straight, its arrays at the opened state as the save holds them, and its first step's roster,
// gold, floor and bag those of a run that never stopped under the old program, since the formula reaches only the
// foe. Under `inserted` (a field before the roster, the layout V2) it's refused, naming sha256(V1) and sha256(V2).
import { describe, expect, it } from 'vitest';
import { AC, STEP_60, TIMEOUT, bakeCall, bakeOf, logicBin, one, openSaveCall, openedOf, prebuild, readSave, refusalOf, saveFile, savesDir, sha256, valuesAt, type Bake, type SaveWritten } from './helpers.ts';
import { dungeonPiece, dungeonTrack } from './pieces.ts';
import { DUNGEON, SAVED_AT, V1, V2 } from './programs.ts';

prebuild(() => { logicBin(); });

const END = SAVED_AT + 60;
const KEPT = ['roster', 'gold', 'floor'];
let saved: { dir: string; save: SaveWritten } | undefined;
function savedOld(): { dir: string; save: SaveWritten } {
  if (saved) return saved;
  const dir = savesDir();
  const b = bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: dir })), 'the bake that saves under the old program');
  expect(b.saves.map((s) => [s.item, s.slot, s.step]), 'the dungeon asks for slot 1 at the end of step 1,799').toEqual([[DUNGEON, 1, SAVED_AT]]);
  saved = { dir, save: b.saves[0]! };
  return saved;
}
let nq: Bake | undefined;
const neverStopped = (): Bake => (nq ??= bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: END })), 'the run that never stopped, under the old program'));

describe(`${AC[1]} a save bound to the state layout its program exports`, () => {
  it(`${AC[1]} saved at 1,800, the save binds its layout's hash, and after a fix that changes only the damage formula and keeps the layout it opens straight, with its roster, gold and floor as they were saved`, () => {
    const { dir, save } = savedOld();
    const header = readSave(saveFile(dir, save.hash)).header;
    expect(header['layout'], 'the save binds the hash of the bytes its program exports at layout_at, after their u32 length').toBe(sha256(V1));
    const frames = [{ from: (SAVED_AT - 1) * STEP_60, count: 1, arrays: KEPT.map((n) => `${DUNGEON}.${n}`) }];
    const o = openedOf(one(openSaveCall(dungeonPiece('fix'), { saves_dir: dir, track: dungeonTrack(), steps: END, frames })), 'open_save under the damage fix');
    expect([o.hash, o.step, o.via], 'the save opens straight, at step 1,800').toEqual([save.hash, SAVED_AT, 'straight']);
    const run = neverStopped();
    const at = (k: number) => run.steps.find((s) => s.step === k);
    const frame = o.frames[0]?.[0];
    for (const n of KEPT) expect(frame?.arrays[`${DUNGEON}.${n}`], `${n} at the opened state is as saved (step 1,799's)`).toEqual(valuesAt(at(SAVED_AT - 1), DUNGEON, n));
    const first = o.steps.find((s) => s.step === SAVED_AT);
    for (const n of [...KEPT, 'bag']) expect(valuesAt(first, DUNGEON, n), `step 1,800 under the fix reads ${n} from the saved state: the old program's own step 1,800`).toEqual(valuesAt(at(SAVED_AT), DUNGEON, n));
    const foeDiffers = o.steps.some((s) => JSON.stringify(valuesAt(s, DUNGEON, 'foe')) !== JSON.stringify(valuesAt(at(s.step), DUNGEON, 'foe')));
    expect(foeDiffers, 'the fix is the program that ran on: its foe takes the new damage within 60 steps').toBe(true);
  }, TIMEOUT);

  it(`${AC[1]} the same save, after a change that inserts a field before the roster and exports a new layout, is refused without a migration, naming both layouts`, () => {
    const { dir, save } = savedOld();
    const r = refusalOf(one(openSaveCall(dungeonPiece('inserted'), { saves_dir: dir, track: dungeonTrack(), steps: END })), 'open_save under the inserted field');
    expect([r.code, r.save], 'the save is refused').toEqual(['save_refused', save.hash]);
    const layout = r.differs.find((d) => d.what === 'layout');
    expect([layout?.save, layout?.piece], `naming both layouts, the save's and the piece's: ${JSON.stringify(r.differs)}`).toEqual([sha256(V1), sha256(V2)]);
    expect(r.damaged, 'and nothing reads as damaged').toEqual([]);
  }, TIMEOUT);
});

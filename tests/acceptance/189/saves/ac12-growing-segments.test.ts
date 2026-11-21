// Criterion 12: "The dungeon saved at step 1,800, after a fix that adds a 1 KiB constant table and so grows its data
// segments past the old ones while keeping its layout bytes, is refused at open, naming the segment and the first offset
// that overlaps saved state; a planted open that writes the new segments over the save's pages opens with the roster
// overwritten and fails, naming roster"
//
// Through `deep-logic` (README: deep-logic, Refusals). The old dungeon's active segments are its layout bytes
// (segment 0, at 6,144) and its damage table (segment 1, 8,176 to 8,192); its roster starts at 8,192. `table` keeps
// both and adds a 1 KiB table as segment 2, at 8,192 to 9,216: past the old segments, over the roster and gold. The
// first offset that overlaps saved state is the first byte in that range the save holds nonzero, read from the saved
// roster and gold (little-endian i32s from 8,192; nothing else lives there). `judge` is the criterion's comparison:
// step 1,800 under the fix reads the roster, gold and floor the saved state holds, so it equals the old program's.
// `open_writes_new_segments` opens straight and writes the new segments over the save's pages.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, firstStepDiff, logicBin, one, openSaveCall, openedOf, prebuild, refusalOf, savesDir, valuesAt, type Bake, type Opened, type SaveWritten } from './helpers.ts';
import { dungeonPiece, dungeonTrack } from './pieces.ts';
import { DUNGEON, ROSTER_AT, SAVED_AT, TABLE_AT, TABLE_BYTES } from './programs.ts';

prebuild(() => { logicBin(); });

const END = SAVED_AT + 60;
let saved: { dir: string; save: SaveWritten } | undefined;
function savedOld(): { dir: string; save: SaveWritten } {
  if (saved) return saved;
  const dir = savesDir();
  const b = bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: dir })), 'the bake that saves');
  expect(b.saves.map((s) => s.step), 'slot 1 is saved at step 1,800').toEqual([SAVED_AT]);
  saved = { dir, save: b.saves[0]! };
  return saved;
}
let nq: Bake | undefined;
const neverStopped = (): Bake => (nq ??= bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: END })), 'the run that never stopped, under the old program'));
/** The criterion's comparison: the first of roster, gold and floor whose step differs from the old program's run. */
function judge(o: Opened): string | null {
  const d = firstStepDiff(o.steps, neverStopped().steps.filter((s) => s.step >= SAVED_AT), DUNGEON, ['roster', 'gold', 'floor']);
  return d ? `${d.array} differs at step ${d.step}, element ${d.element}, from the saved state's` : null;
}

describe(`${AC[12]} a fix whose data segments grow over saved state`, () => {
  it(`${AC[12]} after a fix that adds a 1 KiB constant table past the old segments and keeps the layout bytes, the save is refused at open, naming the segment and the first offset that overlaps saved state`, () => {
    const { dir, save } = savedOld();
    const at1799 = neverStopped().steps.find((s) => s.step === SAVED_AT - 1);
    const held = Buffer.from(Int32Array.from([...(valuesAt(at1799, DUNGEON, 'roster') as number[]), ...(valuesAt(at1799, DUNGEON, 'gold') as number[])]).buffer);
    const first = ROSTER_AT + held.findIndex((b) => b !== 0);
    expect(first >= TABLE_AT && first < TABLE_AT + TABLE_BYTES, `the saved roster holds a nonzero byte under the new table, first at ${first}`).toBe(true);
    const r = refusalOf(one(openSaveCall(dungeonPiece('table'), { saves_dir: dir, track: dungeonTrack(), steps: END })), 'open_save under the fix with the 1 KiB table');
    expect([r.code, r.save], 'refused at open').toEqual(['save_refused', save.hash]);
    const seg = r.differs.find((d) => d.what === 'segment');
    expect([seg?.segment, seg?.offset], `naming the new table's segment, 2, and the first offset that overlaps saved state: ${JSON.stringify(r.differs.map((d) => d.raw))}`).toEqual([2, first]);
    expect(r.differs.filter((d) => d.what === 'layout'), 'the layout bytes are kept: no layout difference is named').toEqual([]);
  }, TIMEOUT);

  it(`${AC[12]} a planted open that writes the new segments over the save's pages (open_writes_new_segments) opens with the roster overwritten and fails, naming roster`, () => {
    const { dir, save } = savedOld();
    const o = openedOf(one(openSaveCall(dungeonPiece('table'), { saves_dir: dir, track: dungeonTrack(), steps: END }), ['open_writes_new_segments']), 'open_save under the planted open');
    expect([o.hash, o.via], 'the planted open opens the save straight').toEqual([save.hash, 'straight']);
    const failure = judge(o);
    expect(failure, 'its run fails the comparison with the saved state').not.toBeNull();
    expect(failure, 'naming roster, which the table overwrote').toMatch(/^roster /);
  }, TIMEOUT);
});

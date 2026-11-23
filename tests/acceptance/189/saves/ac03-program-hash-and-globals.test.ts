// Criterion 3: "A program that exports no layout keeps #171's binding: a save opened after any change to it is refused
// without a migration, naming both program hashes; and a program that keeps the layout bytes but declares one more
// mutable global than the save holds is refused, naming that global"
//
// Through `deep-logic` (README: deep-logic, Refusals). `bare` is the dungeon with no `layout_at` (and no layout
// segment), so its layout is its program hash; `bare_nop` is it with one `nop` more. `extra` exports V1's bytes, as
// the old dungeon does, and declares a third mutable global, `$extra`, last: global 5 of the program as written
// (programs.ts: EXTRA_GLOBAL_INDEX).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, bakeCall, bakeOf, checkCall, logicBin, one, openSaveCall, prebuild, readSave, refusalOf, saveFile, savesDir, type Checked } from './helpers.ts';
import { dungeonPiece, dungeonTrack, type VariantName } from './pieces.ts';
import { DUNGEON, EXTRA_GLOBAL_INDEX, SAVED_AT } from './programs.ts';

prebuild(() => { logicBin(); });

function savedUnder(name: VariantName): { dir: string; hash: string } {
  const dir = savesDir();
  const b = bakeOf(one(bakeCall(dungeonPiece(name), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: dir })), `the bake that saves under ${name}`);
  expect(b.saves.map((s) => s.step), 'slot 1 is saved at step 1,800').toEqual([SAVED_AT]);
  return { dir, hash: b.saves[0]!.hash };
}
const checked = (name: VariantName): Checked => admitted(one(checkCall(dungeonPiece(name))), `check of ${name}`)[DUNGEON]!;
/** A program hash, as a save or a refusal names it: the program as given or as rewritten (#534's README: Layouts). */
const programHashes = (c: Checked): string[] => [c.program, c.hash];

describe(`${AC[3]} a program with no layout keeps the program-hash binding; one more mutable global is refused`, () => {
  it(`${AC[3]} a program that exports no layout: a save opened after a change to it is refused without a migration, naming both program hashes`, () => {
    const { dir, hash } = savedUnder('bare');
    const [old, now] = [checked('bare'), checked('bareNop')];
    expect(old.program, 'the change gives another program').not.toBe(now.program);
    expect(programHashes(old), 'the save binds its program hash as its layout').toContain(readSave(saveFile(dir, hash)).header['layout']);
    const r = refusalOf(one(openSaveCall(dungeonPiece('bareNop'), { saves_dir: dir, track: dungeonTrack(), steps: SAVED_AT + 60 })), 'open_save after the change');
    expect([r.code, r.save], 'refused').toEqual(['save_refused', hash]);
    const layout = r.differs.find((d) => d.what === 'layout');
    expect(layout, `naming what differs: the layout, its program hash (${JSON.stringify(r.differs)})`).toBeDefined();
    expect(programHashes(old), 'the save\'s side names the old program hash').toContain(layout!.save);
    expect(programHashes(now), 'the piece\'s side names the new program hash').toContain(layout!.piece);
  }, TIMEOUT);

  it(`${AC[3]} a program that keeps the layout bytes but declares one more mutable global than the save holds is refused, naming that global`, () => {
    const { dir, hash } = savedUnder('old');
    const r = refusalOf(one(openSaveCall(dungeonPiece('extra'), { saves_dir: dir, track: dungeonTrack(), steps: SAVED_AT + 60 })), 'open_save under one more mutable global');
    expect([r.code, r.save], 'refused').toEqual(['save_refused', hash]);
    const g = r.differs.find((d) => d.what === 'globals');
    expect(g?.global, `naming that global: global ${EXTRA_GLOBAL_INDEX} of the program (${JSON.stringify(r.differs)})`).toBe(EXTRA_GLOBAL_INDEX);
    expect(r.differs.filter((d) => d.what === 'layout'), 'the layout itself matches: no layout difference is named').toEqual([]);
  }, TIMEOUT);
});

// Criterion 3: "A save written under one program hash, opened after the piece's logic program changed, is refused
// when the piece declares no migration, naming both program hashes; with a migration declared for that hash it opens
// through the migration and is written as a new save, while the old save's bytes stay as they were"
//
// Through `deep-logic` (README: deep-logic, Save files, Migrations). The dungeon (which exports no state layout, so
// its layout is its program hash) saves slot 1 at steps 1,200 and 1,800; then its program changes (one `nop` more).
// With no migration the newest save is refused, naming the old and the new program hashes. With a migration declared
// from the save's binding fields (its layout, content and module set, read from the save's header), `migration`
// (programs.ts) adds 1,000 to the health global: the slot opens through it, the result is a new save under the new
// program's layout, the old saves' bytes are unchanged, the migrated run's health is the never-quit run's plus 1,000
// at every step while its floor and inventory are the never-quit run's, and the new save then opens straight.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, checkCall, admitted, keptSaves, logicBin, openSaveCall, openedOf, prebuild, readSave, refusalOf, run, savesDir, sha256, str, type Checked, type SaveWritten } from './helpers.ts';
import { DUNGEON, dungeonPiece, dungeonTrack, migrationId } from './dungeon.ts';
import { MIGRATION_HEALTH } from './programs.ts';

prebuild(() => { logicBin(); });

const checked = (variant: 'same' | 'nop'): Checked => admitted(run([checkCall(dungeonPiece(variant))])[0]!, `check of the dungeon (${variant})`)[DUNGEON]!;
/** A program hash, as a save or a refusal names it: the program as given or as rewritten (README: Layouts). */
const programHashes = (c: Checked): string[] => [c.hash, c.program];
function savedUnderOld(): { dir: string; saves: SaveWritten[] } {
  const dir = savesDir();
  const [saving] = run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: 1800, saves_dir: dir })]);
  const saves = bakeOf(saving!, 'the bake that saves under the old program').saves;
  expect(saves.map((s) => s.step), 'slot 1 holds saves at steps 1,200 and 1,800').toEqual([1200, 1800]);
  return { dir, saves };
}

describe(`${AC[3]} a save under a changed program is refused without a migration and migrated with one`, () => {
  it(`${AC[3]} opened after the program changed, with no migration declared, the save is refused, naming both program hashes`, () => {
    const { dir, saves } = savedUnderOld();
    const [old, now] = [checked('same'), checked('nop')];
    expect(old.hash, 'the change gives another program hash').not.toBe(now.hash);
    const header = readSave(join(dir, `${saves[1]!.hash}.save`)).header;
    expect(programHashes(old), 'the save is bound to the old program\'s hash as its layout (no state layout exported)').toContain(header['layout']);
    const [open] = run([openSaveCall(dungeonPiece('nop'), { saves_dir: dir, slot: 1, track: dungeonTrack(), steps: 1860 })]);
    const r = refusalOf(open!, 'open_save under the changed program, no migration');
    expect(r.code, 'refused as a save that doesn\'t match').toBe('save_refused');
    expect(r.save, 'naming the save').toBe(saves[1]!.hash);
    const layout = r.differs.find((d) => d.what === 'layout');
    expect(layout, `naming what differs: the layout, its program hash (${JSON.stringify(r.differs)})`).toBeDefined();
    expect(programHashes(old), 'the save\'s side names the old program hash').toContain(layout!.save);
    expect(programHashes(now), 'the piece\'s side names the new program hash').toContain(layout!.piece);
    expect(r.damaged, 'and nothing reads as damaged').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} with a migration declared for that hash, the save opens through the migration and is written as a new save, while the old save's bytes stay as they were`, () => {
    const { dir, saves } = savedUnderOld();
    const oldFile = join(dir, `${saves[1]!.hash}.save`);
    const oldBytes = readFileSync(oldFile);
    const h = readSave(join(dir, `${saves[1]!.hash}.save`)).header;
    const from = { layout: str(h['layout'], 'header.layout'), content: str(h['content'], 'header.content'), modules: str(h['modules'], 'header.modules') };
    const migrated = dungeonPiece('nop', [{ from, by: migrationId() }]);
    const [open] = run([openSaveCall(migrated, { saves_dir: dir, slot: 1, track: dungeonTrack(), steps: 2400 })]);
    const o = openedOf(open!, 'open_save under the changed program with a migration');
    expect([o.via, o.from, o.step], 'the newest save opens through the migration, at step 1,800').toEqual(['migration', saves[1]!.hash, 1800]);
    expect(o.hash, 'as a new save').not.toBe(saves[1]!.hash);
    const written = readSave(join(dir, `${o.hash}.save`));
    expect(sha256(written.bytes), 'the new save is a file of the slot that reads back whole').toBe(o.hash);
    expect(programHashes(checked('nop')), 'bound to the changed program\'s layout').toContain(written.header['layout']);
    expect([written.header['slot'], written.header['step']], 'in slot 1, at step 1,800').toEqual([1, 1800]);
    expect(keptSaves(dir), 'the old save stays beside the new one').toContain(`${saves[1]!.hash}.save`);
    expect(readFileSync(oldFile).equals(oldBytes), 'its bytes as they were').toBe(true);
    const [nqReply] = run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: 2400 })]);
    const nq = bakeOf(nqReply!, 'the never-quit run under the old program').steps.filter((s) => s.step >= 1800);
    expect(o.steps.map((s) => s.step), 'the migrated run plays steps 1,800 to 2,399').toEqual(nq.map((s) => s.step));
    const at = (s: { arrays: Record<string, unknown[]> }, n: string): unknown => s.arrays[`${DUNGEON}.${n}`];
    expect(o.steps.map((s) => at(s, 'health')), `its health is the never-quit run's plus ${MIGRATION_HEALTH}: what the migration wrote`).toEqual(nq.map((s) => [(at(s, 'health') as number[])[0]! + MIGRATION_HEALTH]));
    expect(o.steps.map((s) => [at(s, 'floor'), at(s, 'inv')]), 'its floor and inventory are the never-quit run\'s').toEqual(nq.map((s) => [at(s, 'floor'), at(s, 'inv')]));
    const [again] = run([openSaveCall(dungeonPiece('nop'), { saves_dir: dir, slot: 1, track: dungeonTrack(), steps: 1860 })]);
    const o2 = openedOf(again!, 'open_save of the migrated save under the changed program, no migration');
    expect([o2.hash, o2.via], 'the new save opens straight under the changed program').toEqual([o.hash, 'straight']);
  }, TIMEOUT);
});

// Criterion 4: "A migration from the dungeon's old layout at 32 MiB of memory to a new one at 48 MiB, which moves the
// roster and renames 3 item keys through a remap table, opens the save as a new save where the roster reads as it was
// and the 3 items read their new keys, while the old save's bytes stay as they were; copying the 32 MiB alone costs over
// 33,000,000 fuel, within its budget but past a step's cap, so a planted module that runs migrations under a step's
// budget traps with kind fuel, naming the migration"
//
// Through `deep-logic` (README: deep-logic, Migrations). The old dungeon (32 MiB, layout V1) saves slot 1 at step
// 1,800. `m48` (48 MiB, layout V48: the roster moved past the old 32 MiB) declares a migration from {sha256(V1), the
// save's content, its module set} by `migration` (programs.ts) with the remap table {11 → 211, 12 → 212, 13 → 213}.
// The budget is the design's: fuel 8 a byte of both memories, 671,088,640; memory 48 + 32 + 4 MiB; stack 256 KiB. A
// step's cap is the most fuel a step's budget may give an item, 10,000,000, which the dungeon's item declares.
// `migration_runs_under_step_budget` runs the migration under the item's step budget instead.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, MIB, TIMEOUT, bakeCall, bakeOf, bindingOf, folderWith, keptSaves, logicBin, migrationOf, one, openSaveCall, openedOf, prebuild, readSave, refusalOf, saveFile, savesDir, sha256, show, valuesAt, type Bake, type JsonObject, type Migration, type SaveWritten } from './helpers.ts';
import { dungeonPiece, dungeonTrack } from './pieces.ts';
import { BAG_START, DUNGEON, RENAMED, SAVED_AT, V1, V48, migration, remapTable } from './programs.ts';

prebuild(() => { logicBin(); });

const END = SAVED_AT + 60;
const OLD = 32 * MIB;
const NEW = 48 * MIB;
let saved: { dir: string; save: SaveWritten; file: string } | undefined;
function savedOld(): { dir: string; save: SaveWritten; file: string } {
  if (saved) return saved;
  const dir = savesDir();
  const b = bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: dir })), 'the bake that saves at 32 MiB');
  expect(b.saves.map((s) => s.step), 'slot 1 is saved at step 1,800').toEqual([SAVED_AT]);
  saved = { dir, save: b.saves[0]!, file: saveFile(dir, b.saves[0]!.hash) };
  return saved;
}
/** The 48 MiB dungeon with its migration from the old layout, the save's content and its module set. */
function migrating(): JsonObject {
  const { file } = savedOld();
  const h = bindingOf(file);
  const from: Migration['from'] = { layout: sha256(V1), content: h.content, modules: h.modules };
  return dungeonPiece('m48', { migrate: [{ from, by: migration().sha, remap: sha256(remapTable()) }], assets: [migration().bytes, remapTable()] });
}
let nq: Bake | undefined;
const neverStopped = (): Bake => (nq ??= bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: END })), 'the run that never stopped, at 32 MiB'));
const renamed = (keys: number[]): number[] => keys.map((k) => RENAMED.find(([a]) => a === k)?.[1] ?? k);

describe(`${AC[4]} a migration from 32 MiB to 48 MiB with a remap table, under a budget scaled to memory`, () => {
  it(`${AC[4]} the migration moves the roster and renames 3 item keys: the save opens as a new save where the roster reads as it was and the 3 items read their new keys, while the old save's bytes stay; its 32 MiB copy costs over 33,000,000 fuel, within its budget and past a step's cap`, () => {
    const { dir, save, file } = savedOld();
    expect(readSave(file).header['layout'], 'the old save binds the old layout').toBe(sha256(V1));
    const oldBytes = readFileSync(file);
    const reply = one(openSaveCall(migrating(), { saves_dir: dir, track: dungeonTrack(), steps: END }));
    const o = openedOf(reply, 'open_save under the 48 MiB layout with its migration');
    expect([o.via, o.from, o.step], 'the save opens through the migration, at step 1,800').toEqual(['migration', save.hash, SAVED_AT]);
    expect(o.hash, 'as a new save').not.toBe(save.hash);
    const written = readSave(saveFile(dir, o.hash));
    expect(sha256(written.bytes), 'the new save is a file of the slot that reads back whole').toBe(o.hash);
    expect([written.header['layout'], written.header['slot'], written.header['step']], 'bound to the new layout, in slot 1, at step 1,800').toEqual([sha256(V48), 1, SAVED_AT]);
    expect(keptSaves(dir), 'the old save stays beside it').toContain(`${save.hash}.save`);
    expect(readFileSync(file).equals(oldBytes), 'with its bytes as they were').toBe(true);
    const first = o.steps.find((s) => s.step === SAVED_AT);
    const was = neverStopped().steps.find((s) => s.step === SAVED_AT);
    expect(valuesAt(first, DUNGEON, 'roster'), 'the roster, read from where the new layout moved it, reads as it was').toEqual(valuesAt(was, DUNGEON, 'roster'));
    expect(valuesAt(was, DUNGEON, 'bag')?.slice(0, 4), 'the bag held four items when it was saved').toEqual(BAG_START);
    expect(valuesAt(first, DUNGEON, 'bag'), 'and 3 of them read their new keys').toEqual(renamed(valuesAt(was, DUNGEON, 'bag') as number[]));
    const m = migrationOf(reply, 'open_save under the 48 MiB layout');
    expect(m.by, 'the migration that ran').toBe(migration().sha);
    expect(m.budget, 'its budget: fuel 8 a byte of the old and new memories, memory the new plus the old plus 4 MiB, stack 256 KiB').toEqual({ fuel: 8 * (OLD + NEW), memory: NEW + OLD + 4 * MIB, stack: 256 * 1024 });
    expect(m.fuel, `copying the 32 MiB alone costs over 33,000,000 fuel (${m.fuel})`).toBeGreaterThan(33_000_000);
    expect(m.fuel, 'within its budget').toBeLessThanOrEqual(m.budget.fuel);
    expect(m.fuel, 'past a step\'s cap of 10,000,000').toBeGreaterThan(10_000_000);
  }, TIMEOUT);

  it(`${AC[4]} a planted module that runs migrations under a step's budget (migration_runs_under_step_budget) traps with kind fuel, naming the migration, and leaves only the old save`, () => {
    const { save, file } = savedOld();
    const dir = folderWith(file);
    const oldBytes = readFileSync(file);
    const r = refusalOf(one(openSaveCall(migrating(), { saves_dir: dir, track: dungeonTrack(), steps: END }), ['migration_runs_under_step_budget']), 'open_save with the migration under a step\'s budget');
    expect([r.code, r.save], 'the migration fails on the save').toEqual(['migration_failed', save.hash]);
    expect(r.raw['by'], 'naming the migration').toBe(migration().sha);
    expect((r.raw['trap'] as JsonObject | null)?.['kind'], `with its trap, of kind fuel: ${show(r.raw)}`).toBe('fuel');
    expect(keptSaves(dir), 'only the old save is left').toEqual([`${save.hash}.save`]);
    expect(readFileSync(saveFile(dir, save.hash)).equals(oldBytes), 'with its bytes as they were').toBe(true);
  }, TIMEOUT);
});

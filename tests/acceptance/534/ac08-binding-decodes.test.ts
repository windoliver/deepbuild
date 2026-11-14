// Criterion 8: "A save whose state no longer decodes, but whose binding fields do, is refused or migrated by those
// fields and never reads as a save cut short"
//
// Through `deep-logic` and the save file itself (README: Save files: a JSON header line holding every binding field,
// a newline, then the state, the file named by its sha256). The dungeon saves slot 1 at step 1,200 under its first
// program; the test reads the header without the state, then writes a save whose header is that one and whose state
// is 4,096 seeded bytes no build decodes, named by its own sha256, so it reads back whole. Under the changed program
// (another program hash, so another layout) it is refused by its binding fields, naming the layout, with no
// migration; with a migration declared from its binding fields it takes the migration's path (opened through it, or
// the migration's own failure); neither reads it as damaged, and its bytes stay as they were.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, BINDING, TIMEOUT, bakeCall, bakeOf, bytesOf, keptSaves, logicBin, openSaveCall, openedOf, prebuild, readSave, refusalOf, run, savesDir, sha256, str, type JsonObject } from './helpers.ts';
import { dungeonPiece, dungeonTrack, migrationId } from './dungeon.ts';

prebuild(() => { logicBin(); });

/** A real save of the dungeon at step 1,200, and a copy whose state no build decodes, alone in a folder of its own. */
function undecodable(): { header: JsonObject; dir: string; hash: string; bytes: Buffer } {
  const written = savesDir();
  const b = bakeOf(run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: 1200, saves_dir: written })])[0]!, 'the bake that saves at 1,200');
  const s = readSave(join(written, `${b.saves[0]!.hash}.save`));
  for (const f of BINDING) expect(f in s.header, `the save's header line holds ${f}, read without its state`).toBe(true);
  expect([s.header['slot'], s.header['step'], s.header['ended']], 'and they decode: slot 1, step 1,200, not ended').toEqual([1, 1200, false]);
  expect(s.state.length, 'the state follows the header').toBeGreaterThan(0);
  const bytes = Buffer.concat([Buffer.from(`${JSON.stringify(s.header)}\n`), bytesOf(534_81, 4096)]);
  const hash = sha256(bytes);
  const dir = savesDir();
  writeFileSync(join(dir, `${hash}.save`), bytes);
  return { header: s.header, dir, hash, bytes };
}

describe(`${AC[8]} a save's binding fields decode without its state, and decide its fate`, () => {
  it(`${AC[8]} a save whose state no longer decodes is refused by its binding fields, naming the layout, and never reads as cut short`, () => {
    const u = undecodable();
    const reply = run([openSaveCall(dungeonPiece('nop'), { saves_dir: u.dir, slot: 1, track: dungeonTrack(), steps: 1260 })])[0]!;
    const r = refusalOf(reply, 'open_save of the undecodable save under the changed program, no migration');
    expect(r.code, 'refused as a save that doesn\'t match, by its binding fields').toBe('save_refused');
    expect(r.save, 'naming the save').toBe(u.hash);
    const layout = r.differs.find((d) => d.what === 'layout');
    expect(layout?.save, `naming its layout, read from its binding fields: ${JSON.stringify(r.differs)}`).toBe(u.header['layout']);
    expect(r.damaged.map((d) => d.hash), 'it never reads as a save cut short').not.toContain(u.hash);
    expect(readFileSync(join(u.dir, `${u.hash}.save`)).equals(u.bytes), 'its bytes stay as they were').toBe(true);
  }, TIMEOUT);

  it(`${AC[8]} with a migration declared from its binding fields, the undecodable save takes the migration's path and never reads as cut short`, () => {
    const u = undecodable();
    const from = { layout: str(u.header['layout'], 'layout'), content: str(u.header['content'], 'content'), modules: str(u.header['modules'], 'modules') };
    const reply = run([openSaveCall(dungeonPiece('nop', [{ from, by: migrationId() }]), { saves_dir: u.dir, slot: 1, track: dungeonTrack(), steps: 1260 })])[0]!;
    if (reply['ok'] === true) {
      const o = openedOf(reply, 'open_save through the migration');
      expect([o.via, o.from], 'it opens through the migration declared for its fields').toEqual(['migration', u.hash]);
      expect(o.damaged.map((d) => d.hash), 'and never reads as cut short').not.toContain(u.hash);
    } else {
      const r = refusalOf(reply, 'open_save through the migration');
      expect([r.code, r.save, r.raw['by']], `the migration's own failure, naming the save and the migration: ${JSON.stringify(reply).slice(0, 600)}`).toEqual(['migration_failed', u.hash, migrationId()]);
      expect(r.damaged.map((d) => d.hash), 'never a save cut short').not.toContain(u.hash);
    }
    expect(keptSaves(u.dir), 'the undecodable save stays').toContain(`${u.hash}.save`);
    expect(readFileSync(join(u.dir, `${u.hash}.save`)).equals(u.bytes), 'its bytes as they were').toBe(true);
  }, TIMEOUT);
});

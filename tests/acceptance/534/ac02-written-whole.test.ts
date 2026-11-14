// Criterion 2: "A save cut short by one byte is caught by its hash on opening, named, and the slot's last good save
// opens instead, at the full-state hash recorded when it was written; and a save whose writing is killed before its
// rename leaves the slot's newest save as it was"
//
// Through `deep-logic` (README: deep-logic, Save files). The dungeon saves slot 1 at steps 1,200 and 1,800; the test
// cuts the newest file short by its last byte and opens the slot in a new process. For the killed write, `hoard`
// holds a nonzero byte in each page of a 64 MiB memory (so each save is about 64 MiB) and saves slot 1 at steps 10
// and 20 through a session (`open`, `step`); while the second save is still under its temporary name (`*.tmp` in
// the saves folder) the test freezes the process (SIGSTOP), confirms the rename hasn't happened, and kills it
// (SIGKILL), both by its PID; then a new process opens the slot.
import { readFileSync, readdirSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, SAVE_FILE, TIMEOUT, bakeCall, bakeOf, keptSaves, live, logicBin, openSaveCall, openedOf, piece, prebuild, run, savesDir, savesOf, sha256, show, str, type JsonObject } from './helpers.ts';
import { DUNGEON, dungeonPiece, dungeonTrack } from './dungeon.ts';
import { hoard } from './programs.ts';

prebuild(() => { logicBin(); });

const HOARD = 'hoard';
const HOARD_PAGES = 1024;
function hoardPiece(): JsonObject {
  return piece({ seed: 534_02, items: { [HOARD]: { program: hoard(HOARD_PAGES, [9, 19]), writes: { request: { type: 'i32' } }, budget: { memory: 64 }, saves: { slots: 1, request: 'request' } } } });
}

describe(`${AC[2]} a save is written whole: a cut-short save is caught by its hash, and a killed write leaves the slot as it was`, () => {
  it(`${AC[2]} a save cut short by one byte is caught by its hash on opening, named, and the slot's last good save opens instead, at the full-state hash recorded when it was written`, () => {
    const dir = savesDir();
    const [saving] = run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: 1800, saves_dir: dir })]);
    const b = bakeOf(saving!, 'the bake that saves');
    const [good, newest] = b.saves;
    expect([good?.step, newest?.step], 'slot 1 holds saves at steps 1,200 and 1,800').toEqual([1200, 1800]);
    expect(keptSaves(dir).sort(), 'the slot keeps both, each as <sha256>.save').toEqual([`${good!.hash}.save`, `${newest!.hash}.save`].sort());
    for (const s of [good!, newest!]) expect(sha256(readFileSync(join(dir, `${s.hash}.save`))), `the file of the save at ${s.step} reads back whole`).toBe(s.hash);
    expect(good!.deep_hash[DUNGEON], 'the save at 1,200 records the full-state hash of checkpoint 1,200').toBe(b.checkpoints[DUNGEON]?.find((c) => c.step === 1200)?.deep_hash);
    const file = join(dir, `${newest!.hash}.save`);
    const size = readFileSync(file).length;
    truncateSync(file, size - 1);
    const [open] = run([openSaveCall(dungeonPiece(), { saves_dir: dir, slot: 1, track: dungeonTrack(), steps: 1260 })]);
    const o = openedOf(open!, 'open_save of slot 1 with its newest save cut short');
    expect(o.damaged.map((d) => d.hash), 'the cut-short save is named, by its hash').toEqual([newest!.hash]);
    expect([o.hash, o.step, o.via], 'the slot\'s last good save opens instead').toEqual([good!.hash, 1200, 'straight']);
    expect(o.deep_hash[DUNGEON], 'at the full-state hash recorded when it was written').toBe(good!.deep_hash[DUNGEON]);
    const c = o.checkpoints[DUNGEON]?.[0];
    expect([c?.step, c?.deep_hash], 'its first checkpoint is the opened state').toEqual([1200, good!.deep_hash[DUNGEON]]);
  }, TIMEOUT);

  it(`${AC[2]} a save whose writing is killed before its rename leaves the slot's newest save as it was`, async () => {
    const dir = savesDir();
    const l = live();
    try {
      const opened = await l.call({ call: 'open', piece: hoardPiece(), track: [], saves_dir: dir });
      expect(opened['ok'], `open of the hoard with a saves folder: ${show(opened).slice(0, 400)}`).toBe(true);
      const session = str(opened['session'], 'open.session');
      const first = await l.call({ call: 'step', session, to: 9 });
      expect(first['ok'], `step to 9: ${show(first).slice(0, 400)}`).toBe(true);
      const [a] = savesOf(first['saves'], 'step to 9: saves');
      expect([a?.slot, a?.step], 'the save asked at the end of step 9 is written whole before the reply').toEqual([1, 10]);
      const aBytes = readFileSync(join(dir, `${a!.hash}.save`));
      expect(sha256(aBytes), 'and reads back whole').toBe(a!.hash);
      // Step on: the save asked at the end of step 19 (about 64 MiB) is written under a temporary name first.
      let replied = false;
      const second = l.send({ call: 'step', session, to: 19 }).then((r) => { replied = true; return r; });
      let seen: string | undefined;
      const deadline = Date.now() + 600_000;
      while (!replied && Date.now() < deadline) {
        seen = readdirSync(dir).find((f) => f.endsWith('.tmp'));
        if (seen) break;
        await new Promise<void>((res) => setImmediate(res));
      }
      expect(seen, 'the save of step 20 is written under a temporary name (*.tmp in the saves folder) before it is renamed').toBeDefined();
      l.signal('SIGSTOP');
      const frozen = readdirSync(dir);
      expect(frozen.includes(seen!), 'frozen while its temporary file is still there').toBe(true);
      expect(frozen.filter((f) => SAVE_FILE.test(f)), 'and before its rename: the slot still holds only the save of step 10').toEqual([`${a!.hash}.save`]);
      l.signal('SIGKILL');
      const exit = await l.exited;
      expect(exit, 'the process is killed').toContain('SIGKILL');
      void second;
      expect(keptSaves(dir), 'after the kill the slot holds only the save of step 10').toEqual([`${a!.hash}.save`]);
      expect(readFileSync(join(dir, `${a!.hash}.save`)).equals(aBytes), 'its bytes as they were').toBe(true);
      const [open] = run([openSaveCall(hoardPiece(), { saves_dir: dir, slot: 1, steps: 12 })]);
      const o = openedOf(open!, 'open_save of slot 1 after the killed write');
      expect([o.hash, o.step, o.damaged], 'the slot\'s newest save, the one of step 10, opens, and nothing reads as damaged').toEqual([a!.hash, 10, []]);
      expect(o.deep_hash[HOARD], 'at the full-state hash recorded when it was written').toBe(a!.deep_hash[HOARD]);
    } finally {
      l.signal('SIGKILL');
    }
  }, TIMEOUT);
});

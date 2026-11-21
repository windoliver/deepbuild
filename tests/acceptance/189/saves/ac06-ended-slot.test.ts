// Criterion 6: "A roguelike saved at step 1,800 whose hero dies at step 3,000, where its logic writes the slot into
// ends, opens that slot at step 3,000's state, never step 1,800's, and the slot holds no earlier save once the ended one
// reads back whole; a write killed before the ended save's rename leaves the step-1,800 save as it was; and a planted
// module that keeps the step-1,800 save openable after the ended one reads back fails, naming the slot"
//
// Through `deep-logic` (README: deep-logic, Save files). The roguelike (programs.ts) asks for slot 1 at the end of step
// 1,799 (a save at step 1,800) and, at the end of the step its hero's hp reaches 0, writes slot 1 into `ends` (an ended
// save at step 3,000, as #534's suite numbers a save by the state it holds). Its memory is 64 MiB with a nonzero byte
// in every page, so the ended save's write lasts long enough to freeze and kill by PID while its `*.tmp` exists.
// `judge` is the criterion's comparison, the same for the right module and the planted one
// (`ended_keeps_earlier_save`, given to the process that writes and the one that opens): once the ended save reads back
// whole, the slot holds no other save, and with the ended save cut short the slot opens nothing earlier.
import { readFileSync, readdirSync, truncateSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, SAVE_FILE, TIMEOUT, bakeCall, bakeOf, keptSaves, live, logicBin, one, openSaveCall, openedOf, prebuild, readSave, saveFile, savesDir, savesOf, sha256, show, str, type Planted, type SaveWritten } from './helpers.ts';
import { roguePiece } from './pieces.ts';
import { ROGUE } from './programs.ts';

prebuild(() => { logicBin(); });

const DIES = 3000;
const SAVED = 1800;
function playedToDeath(planted: Planted[] = []): { dir: string; saves: SaveWritten[] } {
  const dir = savesDir();
  const b = bakeOf(one(bakeCall(roguePiece(), { steps: DIES, saves_dir: dir }), planted), `the roguelike's run to its hero's death${planted.length ? ` (${planted.join(', ')})` : ''}`);
  expect(b.saves.map((s) => [s.slot, s.step, s.ended]), 'slot 1 is saved at step 1,800, then saved as ended at step 3,000').toEqual([[1, SAVED, false], [1, DIES, true]]);
  return { dir, saves: b.saves };
}
/** The criterion's comparison: each way slot 1 can still be opened before its end once its ended save read back whole. */
function judge(dir: string, ended: SaveWritten, planted: Planted[]): string[] {
  const failures: string[] = [];
  for (const f of keptSaves(dir).filter((x) => x !== `${ended.hash}.save`)) {
    const h = readSave(`${dir}/${f}`).header;
    if (h['slot'] === 1) failures.push(`slot 1 still holds its save of step ${String(h['step'])} (${f}) once its ended save read back whole`);
  }
  truncateSync(saveFile(dir, ended.hash), statSync(saveFile(dir, ended.hash)).size - 1);
  const reply = one(openSaveCall(roguePiece(), { saves_dir: dir, steps: DIES }), planted);
  if (reply['ok'] === true) {
    const o = openedOf(reply, 'open_save of slot 1 with its ended save cut short');
    failures.push(`slot 1 opens at step ${o.step} with its ended save cut short, before its end at ${DIES}`);
  }
  return failures;
}

describe(`${AC[6]} a game that ends a slot for good`, () => {
  it(`${AC[6]} the roguelike saved at 1,800, its hero dead at 3,000 with the slot written into ends: the slot opens at step 3,000's state, never step 1,800's, and holds no earlier save once the ended one reads back whole`, () => {
    const { dir, saves } = playedToDeath();
    const ended = saves[1]!;
    expect(keptSaves(dir), 'once the ended save reads back whole the slot holds it alone').toEqual([`${ended.hash}.save`]);
    expect([readSave(saveFile(dir, ended.hash)).header['ended'], readSave(saveFile(dir, ended.hash)).header['step']], 'an ended save at step 3,000').toEqual([true, DIES]);
    const o = openedOf(one(openSaveCall(roguePiece(), { saves_dir: dir, steps: DIES })), 'open_save of the ended slot');
    expect([o.hash, o.step], 'the slot opens at step 3,000\'s state').toEqual([ended.hash, DIES]);
    expect(o.deep_hash, 'at the full-state hash its ended save recorded').toEqual(ended.deep_hash);
    expect(judge(dir, ended, []), 'and never at step 1,800\'s, even with its ended save cut short').toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} a write killed before the ended save's rename leaves the step-1,800 save as it was`, async () => {
    const dir = savesDir();
    const l = live();
    try {
      const opened = await l.call({ call: 'open', piece: roguePiece(), track: [], saves_dir: dir });
      expect(opened['ok'], `open of the roguelike with a saves folder: ${show(opened).slice(0, 400)}`).toBe(true);
      const session = str(opened['session'], 'open.session');
      const first = await l.call({ call: 'step', session, to: SAVED - 1 });
      expect(first['ok'], `step to 1,799: ${show(first).slice(0, 400)}`).toBe(true);
      const [a] = savesOf(first['saves'], 'step to 1,799: saves');
      expect([a?.slot, a?.step, a?.ended], 'the save asked at the end of step 1,799 is written whole before the reply').toEqual([1, SAVED, false]);
      const aBytes = readFileSync(saveFile(dir, a!.hash));
      expect(sha256(aBytes), 'and reads back whole').toBe(a!.hash);
      let replied = false;
      void l.call({ call: 'step', session, to: DIES - 1 }).then(() => { replied = true; });
      let seen: string | undefined;
      const deadline = Date.now() + 1_800_000;
      while (!replied && Date.now() < deadline) {
        seen = readdirSync(dir).find((f) => f.endsWith('.tmp'));
        if (seen) break;
        await new Promise<void>((res) => setImmediate(res));
      }
      expect(seen, 'the ended save is written under a temporary name (*.tmp in the saves folder) before it is renamed').toBeDefined();
      l.signal('SIGSTOP');
      const frozen = readdirSync(dir);
      expect(frozen.includes(seen!), 'frozen while its temporary file is still there').toBe(true);
      expect(frozen.filter((f) => SAVE_FILE.test(f)), 'and before its rename: the slot still holds only the save of step 1,800').toEqual([`${a!.hash}.save`]);
      l.signal('SIGKILL');
      expect(await l.exited, 'the process is killed').toContain('SIGKILL');
      expect(keptSaves(dir), 'after the kill the slot holds the save of step 1,800 alone').toEqual([`${a!.hash}.save`]);
      expect(readFileSync(saveFile(dir, a!.hash)).equals(aBytes), 'its bytes as they were').toBe(true);
      const o = openedOf(one(openSaveCall(roguePiece(), { saves_dir: dir, steps: SAVED })), 'open_save of slot 1 after the killed write');
      expect([o.hash, o.step, o.damaged], 'the save of step 1,800 opens, and nothing reads as damaged').toEqual([a!.hash, SAVED, []]);
      expect(o.deep_hash[ROGUE], 'at the full-state hash it recorded').toBe(a!.deep_hash[ROGUE]);
    } finally {
      l.signal('SIGKILL');
    }
  }, TIMEOUT);

  it(`${AC[6]} a planted module that keeps the step-1,800 save openable after the ended one reads back (ended_keeps_earlier_save) fails, naming the slot`, () => {
    const planted: Planted[] = ['ended_keeps_earlier_save'];
    const { dir, saves } = playedToDeath(planted);
    const failures = judge(dir, saves[1]!, planted);
    expect(failures.length, `the planted module fails the comparison: ${failures.join('; ')}`).toBeGreaterThan(0);
    for (const f of failures) expect(f, 'naming the slot').toContain('slot 1');
  }, TIMEOUT);
});

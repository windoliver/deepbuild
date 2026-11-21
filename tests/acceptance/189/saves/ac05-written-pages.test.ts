// Criterion 5: "A save of a 32 MiB memory whose game has written 48 of its pages holds those 48 pages, plus its header
// and the other modules' state, and opens at the full-state hash it recorded; a planted save that leaves out one page
// holding a nonzero byte opens to another full-state hash and is refused, naming the save and the module, and the
// slot's other save opens instead"
//
// Through `deep-logic` (README: deep-logic, Save files, Refusals). The scribe (programs.ts) holds a nonzero byte in
// exactly 48 pages of its 32 MiB memory; beside it a `same_machine.counter@1` item carries the other module's state.
// "Holds those 48 pages, plus its header and the other modules' state": the file is at least 48 pages long and shorter
// than 49, so it holds no other page, and it opens at the full-state hash of each item it recorded in its header.
// `save_drops_a_page` leaves out the save's highest page that holds a nonzero byte (page 471), keeping the hash it
// recorded. The slot's other save is an earlier one, written by the right program first.
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, PAGE, TIMEOUT, bakeCall, bakeOf, logicBin, one, openSaveCall, openedOf, prebuild, readSave, saveFile, savesDir, show, type Planted, type SaveWritten } from './helpers.ts';
import { ADAPTER, COUNTER, saveAt, scribePiece } from './pieces.ts';
import { SCRIBE } from './programs.ts';

prebuild(() => { logicBin(); });

/** One process that plays the scribe to `steps` with a save asked at the end of `at`, and exits. */
function saved(dir: string, at: number, steps: number, planted: Planted[] = []): SaveWritten {
  const b = bakeOf(one(bakeCall(scribePiece(), { track: [saveAt(at)], steps, saves_dir: dir, adapter: ADAPTER }), planted), `the bake that saves at ${at + 1}${planted.length ? ` (${planted.join(', ')})` : ''}`);
  expect(b.saves.map((s) => [s.slot, s.step]), `slot 1 is saved at step ${at + 1}`).toEqual([[1, at + 1]]);
  return b.saves[0]!;
}

describe(`${AC[5]} a save keeps the pages that hold data, and opens only at the full-state hash it recorded`, () => {
  it(`${AC[5]} a save of a 32 MiB memory whose game has written 48 of its pages holds those 48 pages, its header and the other module's state, and opens at the full-state hash it recorded`, () => {
    const dir = savesDir();
    const s = saved(dir, 1799, 1800);
    const file = saveFile(dir, s.hash);
    const size = statSync(file).size;
    expect(size, 'the save holds the 48 pages').toBeGreaterThanOrEqual(48 * PAGE);
    expect(size, 'and no other: with its header and the other module\'s state it is shorter than 49 pages').toBeLessThan(49 * PAGE);
    expect(Object.keys(s.deep_hash).sort(), 'the save recorded the full-state hash of the logic item and of the counter').toEqual([COUNTER, SCRIBE].sort());
    expect(readSave(file).header['deep_hash'], 'in its header').toEqual(s.deep_hash);
    const o = openedOf(one(openSaveCall(scribePiece(), { saves_dir: dir, track: [saveAt(1799)], steps: 1800, adapter: ADAPTER })), 'open_save of the 48-page save');
    expect([o.hash, o.step, o.via, o.refused.length], 'it opens straight at step 1,800').toEqual([s.hash, 1800, 'straight', 0]);
    expect(o.deep_hash, 'at the full-state hashes it recorded').toEqual(s.deep_hash);
  }, TIMEOUT);

  it(`${AC[5]} a planted save that leaves out one page holding a nonzero byte (save_drops_a_page) opens to another full-state hash and is refused, naming the save and the module, and the slot's other save opens instead`, () => {
    const dir = savesDir();
    const good = saved(dir, 1199, 1200);
    const bad = saved(dir, 1799, 1800, ['save_drops_a_page']);
    expect(statSync(saveFile(dir, bad.hash)).size, 'the planted save is a page short').toBeLessThan(48 * PAGE);
    const o = openedOf(one(openSaveCall(scribePiece(), { saves_dir: dir, track: [saveAt(1199)], steps: 1200, adapter: ADAPTER })), 'open_save of the slot whose newest save lacks a page');
    expect(o.refused.map((r) => r.hash), 'the newest save is refused, by its hash').toEqual([bad.hash]);
    const d = o.refused[0]!.differs.find((x) => x.module !== null);
    expect(d?.module, `naming the module whose state differs: ${show(o.refused[0]!.differs.map((x) => x.raw))}`).toMatch(/^logic(@1)?$/);
    expect(d!.save, 'the full-state hash the save recorded').toBe(bad.deep_hash[SCRIBE]);
    expect(d!.piece, 'and another, the one it opened to').not.toBe(d!.save);
    expect([o.hash, o.step, o.via], 'the slot\'s other save opens instead').toEqual([good.hash, 1200, 'straight']);
    expect(o.deep_hash, 'at the full-state hashes it recorded').toEqual(good.deep_hash);
    expect(o.damaged, 'and nothing reads as damaged: the refused save read back whole').toEqual([]);
  }, TIMEOUT);
});

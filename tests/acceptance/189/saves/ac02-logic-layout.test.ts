// Criterion 2: "logic.layout with that save and same = [roster, gold, floor] passes the damage fix over 60 steps of
// continuation probes, with the old program's run from the same save giving the expected arrays; a planted program
// that inserts a 4-byte field before the roster but keeps the old layout bytes opens the save straight and fails
// logic.layout, naming the save, roster, the first element that differs and its step; and with the fixture save
// deleted, logic.layout is BLOCKED, never PASS"
//
// Through `deep-logic`'s `layout` call (README: logic.layout). The fixture save is criterion 1's: the old dungeon's
// save at step 1,800, carried in the piece's assets by its hash beside the program that wrote it. The expected arrays
// are the test's own: an `open_save` of the same save under the old program, fed the entries logic.layout reports it
// fed, gives each step's arrays, which the report's old replica must equal. `shifted` (programs.ts) is the planted
// program: it keeps its state 4 bytes further on, as `inserted` does, but exports V1's bytes. "Deleted": the piece
// names the save and no longer carries it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, STEP_60, TIMEOUT, bakeCall, bakeOf, firstStepDiff, layoutCall, layoutOf, logicBin, names, one, openSaveCall, openedOf, prebuild, saveFile, savesDir, valuesAt, type Entry, type LayoutRun, type SaveWritten } from './helpers.ts';
import { dungeonPiece, dungeonProgram, dungeonTrack, type VariantName } from './pieces.ts';
import { DUNGEON, SAVED_AT } from './programs.ts';

prebuild(() => { logicBin(); });

const SAME = ['roster', 'gold', 'floor'];
const STEPS = 60;
let saved: { dir: string; save: SaveWritten; bytes: Buffer } | undefined;
function fixtureSave(): { dir: string; save: SaveWritten; bytes: Buffer } {
  if (saved) return saved;
  const dir = savesDir();
  const b = bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: dir })), 'the bake that writes the fixture save');
  expect(b.saves.map((s) => s.step), 'the old program saves slot 1 at step 1,800').toEqual([SAVED_AT]);
  saved = { dir, save: b.saves[0]!, bytes: readFileSync(saveFile(dir, b.saves[0]!.hash)) };
  return saved;
}
/** The piece under `name`, carrying the program that wrote the fixture save and, unless deleted, the save itself. */
const withFixture = (name: VariantName, save = true) => dungeonPiece(name, { assets: [dungeonProgram('old').bytes, ...(save ? [fixtureSave().bytes] : [])] });
/** A program's own run from the fixture save, fed a probe's entries: the steps from 1,800 on. */
function runFrom(name: VariantName, entries: Entry[]) {
  return openedOf(one(openSaveCall(dungeonPiece(name), { saves_dir: fixtureSave().dir, track: entries, steps: SAVED_AT + STEPS })), `open_save of the fixture save under ${name}`).steps;
}
const steps = (run: LayoutRun['current']): number[] => run.map((s) => s.step);
const window = Array.from({ length: STEPS }, (_, i) => SAVED_AT + i);

describe(`${AC[2]} logic.layout proves a fix keeps the layout on fixture saves`, () => {
  it(`${AC[2]} with the save and same = [roster, gold, floor] it passes the damage fix over 60 steps of continuation probes, the old program's run from the save giving the expected arrays`, () => {
    const { save } = fixtureSave();
    const rep = layoutOf(one(layoutCall(withFixture('fix'), [save.hash], SAME, STEPS)), 'logic.layout of the damage fix');
    expect([rep.verdict, rep.failures.map((f) => f.raw)], 'logic.layout passes').toEqual(['PASS', []]);
    expect(rep.runs.map((r) => [r.save, r.control, r.via, r.from]), 'one continuation probe, for the one control the item reads, from the save opened straight at 1,800').toEqual([[save.hash, 'move', 'straight', SAVED_AT]]);
    const probe = rep.runs[0]!;
    const entries = probe.entries as unknown as Entry[];
    expect(entries.map((e) => [e.control, e.t]), 'its seeded entry is for move, at step 1,800').toEqual([['move', SAVED_AT * STEP_60]]);
    expect([steps(probe.current), steps(probe.old)], 'both replicas run steps 1,800 to 1,859').toEqual([window, window]);
    const expected = runFrom('old', entries);
    for (const [i, k] of window.entries()) {
      for (const n of SAME) {
        const want = valuesAt(expected.find((s) => s.step === k), DUNGEON, n);
        expect(want, `the old program's own run gives ${n} at step ${k}`).toBeDefined();
        expect(valuesAt(probe.old[i], DUNGEON, n), `the old replica gives the expected ${n} at step ${k}`).toEqual(want);
        expect(valuesAt(probe.current[i], DUNGEON, n), `and the fix gives the same ${n} at step ${k}`).toEqual(want);
      }
    }
  }, TIMEOUT);

  it(`${AC[2]} a planted program that inserts a 4-byte field before the roster but keeps the old layout bytes opens the save straight and fails logic.layout, naming the save, roster, the first element that differs and its step`, () => {
    const { save } = fixtureSave();
    const rep = layoutOf(one(layoutCall(withFixture('shifted'), [save.hash], SAME, STEPS)), 'logic.layout of the planted program');
    expect(rep.verdict, 'logic.layout fails').toBe('FAIL');
    expect(rep.runs.map((r) => [r.save, r.via]), 'the save opened straight: its layout bytes match').toEqual([[save.hash, 'straight']]);
    const entries = rep.runs[0]!.entries as unknown as Entry[];
    const d = firstStepDiff(runFrom('shifted', entries), runFrom('old', entries), DUNGEON, ['roster']);
    expect(d, 'the two programs\' own runs from the save part at step 1,800, at the roster\'s first element').toEqual({ step: SAVED_AT, array: 'roster', element: 0 });
    const f = rep.failures.find((x) => names(x.array, 'roster'));
    expect(f, `a failure names roster: ${JSON.stringify(rep.failures.map((x) => x.raw))}`).toBeDefined();
    expect([f!.save, f!.element, f!.step], 'naming the save, the first element that differs and its step').toEqual([save.hash, d!.element, d!.step]);
  }, TIMEOUT);

  it(`${AC[2]} with the fixture save deleted, logic.layout is BLOCKED, never PASS`, () => {
    const { save } = fixtureSave();
    const rep = layoutOf(one(layoutCall(withFixture('fix', false), [save.hash], SAME, STEPS)), 'logic.layout with its fixture save deleted');
    expect(rep.verdict, 'BLOCKED, never PASS').toBe('BLOCKED');
    expect(rep.ask ?? '', 'with one unblock ask naming the missing save').toContain(save.hash);
  }, TIMEOUT);
});

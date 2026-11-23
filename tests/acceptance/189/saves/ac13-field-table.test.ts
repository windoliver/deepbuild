// Criterion 13: "The dungeon's save, after one change that inserts a field before the roster, renames gold to coins and
// widens floor from i32 to i64, is refused naming all four: the new field added, roster moved, gold missing and coins
// added, and floor retyped; a planted refusal that stops at the first difference names one and fails, naming the rest"
//
// Through `deep-logic` (README: deep-logic, Refusals). Both layouts carry a field table (programs.ts: V1 and V3); V3
// inserts `torch` before the roster, renames gold to coins and widens floor to i64 in place, so the fields that differ
// are exactly five: torch added, roster moved, gold missing, coins added, floor retyped (bag is unchanged). `judge` is
// the criterion's comparison: the expected differences the refusal doesn't name. `refusal_names_first_field` names only
// the first field that differs.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, logicBin, one, openSaveCall, prebuild, refusalOf, savesDir, sha256, type Differ, type Planted } from './helpers.ts';
import { dungeonPiece, dungeonTrack } from './pieces.ts';
import { SAVED_AT, V1, V3 } from './programs.ts';

prebuild(() => { logicBin(); });

const EXPECTED = [['torch', 'added'], ['roster', 'moved'], ['gold', 'missing'], ['coins', 'added'], ['floor', 'retyped']] as const;
let dir: string | undefined;
function savedOld(): string {
  if (dir) return dir;
  const d = savesDir();
  const b = bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: d })), 'the bake that saves');
  expect(b.saves.map((s) => s.step), 'slot 1 is saved at step 1,800').toEqual([SAVED_AT]);
  return (dir = d);
}
function refusedLayout(planted: Planted[] = []): Differ {
  const r = refusalOf(one(openSaveCall(dungeonPiece('v3'), { saves_dir: savedOld(), track: dungeonTrack(), steps: SAVED_AT + 60 }), planted), `open_save under the changed field table${planted.length ? ` (${planted.join(', ')})` : ''}`);
  expect(r.code, 'refused').toBe('save_refused');
  const layout = r.differs.find((d) => d.what === 'layout');
  expect([layout?.save, layout?.piece], `as a layout that differs, naming both layouts: ${JSON.stringify(r.differs.map((d) => d.raw))}`).toEqual([sha256(V1), sha256(V3)]);
  return layout!;
}
const named = (d: Differ): string[] => (d.fields ?? []).map((f) => `${f.name} ${f.class}`).sort();
/** The criterion's comparison: each expected difference the refusal doesn't name. */
const judge = (d: Differ): string[] => EXPECTED.map(([n, c]) => `${n} ${c}`).filter((e) => !named(d).includes(e));

describe(`${AC[13]} a refusal names every field that differs, each with its class`, () => {
  it(`${AC[13]} after one change that inserts a field before the roster, renames gold to coins and widens floor to i64, the save is refused naming all four: the new field added, roster moved, gold missing and coins added, and floor retyped`, () => {
    const d = refusedLayout();
    expect(named(d), 'every field that differs, each with its class, and no other').toEqual(EXPECTED.map(([n, c]) => `${n} ${c}`).sort());
    expect(judge(d), 'nothing left unnamed').toEqual([]);
  }, TIMEOUT);

  it(`${AC[13]} a planted refusal that stops at the first difference (refusal_names_first_field) names one and fails, naming the rest`, () => {
    const d = refusedLayout(['refusal_names_first_field']);
    expect(named(d).length, `the planted refusal names one field: ${JSON.stringify(named(d))}`).toBe(1);
    const rest = judge(d);
    expect(rest.length, `it fails the comparison, naming the other four: ${rest.join(', ')}`).toBe(EXPECTED.length - 1);
  }, TIMEOUT);
});

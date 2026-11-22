// Criterion 6: "A row with no basis is refused at check, naming the row, and an `invented` row's basis reaches the
// layout so a bound value can show it"
//
// Through `deep-logic first_party`, `check` and `bake` (README: The surface): criterion 2's approach with two rows,
// the first cited and fitting no pair, the second criterion 2's, heavy before light, 11,112 m at the threshold.
// - With the second row carrying no `basis`, the check refuses the item, and its refusal names row 1 and no other.
// - With the second row's basis `invented`, the piece is admitted, and the window `conflicts` finds names row 1 with
//   the basis code for invented in the item's array `win_basis`, which a bound value reads by the item's path, as it
//   reads any array of a logic item. Criterion 2's run shows the code for cited from the same row, cited.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arraysAt, bakeCall, bakeOf, checkCall, int, logicBin, onHost, prebuild, refusedOf, show } from '../190/helpers.ts';
import { AC, INTERFACE, layout, piece, separation, windowsOf } from './helpers.ts';
import { BASIS, conflicts, flyAll, type Basis } from './model.ts';
import { script, scriptWrites } from './programs.ts';
import { APPROACH, HEAVY_LIGHT, LIGHT_HEAVY, WIDE, approach } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[6]} every row carries its basis`, () => {
  it(`${AC[6]} a row with no basis is refused at check, naming the row, and an invented row's basis reaches the layout so a bound value can show it`, () => {
    const scene = (basis?: Basis) => approach(WIDE, [LIGHT_HEAVY, HEAVY_LIGHT(basis)]);
    expect([scene().minima.by_pair.map((r) => 'basis' in r), scene('invented').minima.by_pair.map((r) => r.basis === 'invented')], 'row 0 is cited; row 1 has no basis, or is invented').toEqual([[true, false], [false, true]]);
    const want = conflicts(scene('invented'), flyAll(scene('invented')), ...APPROACH.span);
    expect(want.map((w) => [w.row, w.basis, w.min]), 'by the model: one window, of row 1, invented').toEqual([[1, BASIS.invented, 11_112]]);
    expect(new Set(Object.values(BASIS)).size, 'none, cited and invented each have a code of their own').toBe(3);

    const S = separation();
    const writes = scriptWrites(3);
    layout(writes);
    const program = script({ name: 'watch', movers: 3, steps: [[{ op: 'conflicts', span: APPROACH.span }]] }, INTERFACE);
    const item = (basis?: Basis) => piece({ approach: { program, writes, scene: scene(basis), links: [S.ref] } }, [], S.assets);
    const replies = onHost([checkCall(item()), bakeCall(item('invented'), 1)]);

    const r = refusedOf(replies[0]!, 'the check of the minima whose row 1 has no basis');
    expect([r.code, r.item], 'it is refused at check, naming the item').toEqual(['logic_refused', 'approach']);
    expect(r.refusals.filter((x) => typeof x['row'] === 'number').map((x) => x['row']), `a refusal names row 1, and no other row: ${show(r.refusals as never)}`).toEqual([1]);

    const b = bakeOf(replies[1]!, 'the bake of the same minima with row 1 invented');
    expect(b.traps, `the same piece with the row invented is admitted and runs: ${show(b.traps as never)}`).toEqual([]);
    const arrays = arraysAt(b, 'approach', 0);
    const got = windowsOf(arrays);
    expect(got.map((w) => [w.row, w.basis, w.min]), `the window names row 1 and its basis, invented: ${JSON.stringify(got)}`).toEqual([[1, BASIS.invented, 11_112]]);
    expect(int(b.steps[0]!.arrays['approach.win_basis']?.[0], 'approach.win_basis[0]'), 'a bound value reads it as approach.win_basis').toBe(BASIS.invented);
  }, TIMEOUT);
});

// Criterion 2: "A heavy leader and a light follower on one final approach, the follower 9,260 m behind at the
// threshold fix, with a by-pair row of 11,112 m at that fix: `conflicts` returns one window naming the row and its
// basis, and with the row removed it returns none"
//
// Through `deep-logic first_party` and `bake` (README: The surface): the approach (scenes.ts: approach), its minima
// with the one row heavy before light, 11,112 m at the threshold, cited from the fixture's own rule sheet, and the
// same piece with `by_pair` empty. One step asks `conflicts` over the span. By hand the leader passes the threshold at
// 400 s with the follower 9,260 m behind: under the row's 11,112 m and not under the table's 5,556 m, so the row is
// all that makes the window. The window names the row by its index in `by_pair` and its basis by its code; the
// source and the section are the row's own, in the piece.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arraysAt, bakeCall, bakeOf, logicBin, onHost, prebuild, show } from '../190/helpers.ts';
import { AC, INTERFACE, layout, piece, separation, windowsDiffer, windowsOf } from './helpers.ts';
import { BASIS, apart, conflicts, flyAll } from './model.ts';
import { script, scriptWrites } from './programs.ts';
import { APPROACH, CITED, HEAVY_LIGHT, LATERAL, TOL, WIDE, approach } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[2]} a row by pair of classes, measured when the leader passes a fix`, () => {
  it(`${AC[2]} a heavy leader and a light follower on one final approach, the follower 9,260 m behind at the threshold fix, with a by-pair row of 11,112 m at that fix: conflicts returns one window naming the row and its basis, and with the row removed it returns none`, () => {
    const withRow = approach(WIDE, [HEAVY_LIGHT(CITED)]), without = approach(WIDE, []);
    const flown = flyAll(withRow);
    const behind = apart(flown[APPROACH.leader]!, flown[APPROACH.follower]!, APPROACH.measured)!;
    expect([flown[APPROACH.leader]![2]!.time, Math.abs(behind.lateral - 9260) < 1e-9], 'by hand: the leader passes the threshold at 400 s with the follower 9,260 m behind').toEqual([400, true]);
    expect(behind.lateral >= LATERAL && behind.lateral < 11_112, '9,260 m is under the row\'s 11,112 m and not under the table\'s 5,556 m').toBe(true);
    const want = conflicts(withRow, flown, ...APPROACH.span);
    expect(want, 'by the model: one window, at 400 s, of the row').toEqual([{ a: 0, b: 1, from: 400, to: 400, min: 11_112, row: 0, basis: BASIS.cited }]);
    expect(conflicts(without, flown, ...APPROACH.span), 'and none without the row').toEqual([]);
    expect({ ...withRow, minima: { ...withRow.minima, by_pair: [] } }, 'the two pieces differ in the row alone').toEqual(without);

    const S = separation();
    const writes = scriptWrites(3);
    layout(writes);
    const program = script({ name: 'watch', movers: 3, steps: [[{ op: 'conflicts', span: APPROACH.span }]] }, INTERFACE);
    const replies = onHost([withRow, without].map((scene) => bakeCall(piece({ approach: { program, writes, scene, links: [S.ref] } }, [], S.assets), 1)));
    const b = bakeOf(replies[0]!, 'the approach\'s bake with its row');
    expect(b.traps, `the approach runs without a trap: ${show(b.traps as never)}`).toEqual([]);
    const got = windowsOf(arraysAt(b, 'approach', 0));
    expect(got.length, `conflicts returns one window: ${JSON.stringify(got)}`).toBe(1);
    expect([got[0]!.a, got[0]!.b, got[0]!.row, got[0]!.basis, got[0]!.min], 'it is the leader and the follower\'s, and names the row, its basis (cited) and its 11,112 m').toEqual([0, 1, 0, BASIS.cited, 11_112]);
    expect(withRow.minima.by_pair[got[0]!.row]!.basis, 'the row it names holds the source and section the fixture cites').toEqual(CITED);
    expect(windowsDiffer(got, want, TOL), 'measured when the leader passes the threshold, 400 s within 1e-6 s').toEqual([]);
    const none = bakeOf(replies[1]!, 'the approach\'s bake with the row removed');
    expect([none.traps, windowsOf(arraysAt(none, 'approach', 0))], 'with the row removed conflicts returns none').toEqual([[], []]);
  }, TIMEOUT);
});

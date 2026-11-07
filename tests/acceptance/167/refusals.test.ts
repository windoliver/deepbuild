// The "It can never" lines of the issue's Fields that are new with this work and cheap to state, each beside a positive
// control, so a build that refuses everything fails too. `check` is the surface; a refusal is an error issue.
//
// - Scale: "put values ≤ 0 on a log scale (refused, naming the rows)": `ids` hold `<set>#<key>` for those rows alone.
// - Scale: "compute new numbers such as a regression or a density": transforms are a closed list.
// - Scale: "Map a column to a status role": a linear scale whose range is palette roles can't reach a status role.
// - Scale: "mix a number from anything but two periods of one key": changing a later period leaves the mix alone, and a
//   key missing from the next period holds its value rather than mixing across the gap.
// - Mark set: "take a row from an occurrence after t" (the owner's comment on the issue: `rows`, in place of n and data
//   columns, is left for this work).
import { describe, expect, it } from 'vitest';
import {
  LOOK, RACE_SCALES, TIMEOUT, atChannel, canonical, checked, column, document, f32Column, fl, item, lines, near, passes, raceBars, rowsAt, shownIssues, strColumn, useRender, type JsonObject, type JsonValue,
} from './helpers.ts';

const render = useRender();

function logDoc(values: number[]): JsonObject {
  return document('log-167', 'Values on a log scale', [300, 240], 1, [
    item('ys', 'scale@1', 'a0', { type: 'log', domain: [1, 100], range: [220, 20] }),
    item('dots', 'marks@1', 'b0', {
      mark: 'point', n: 4, key: 'key', columns: { key: strColumn(['p', 'q', 'r', 's']), x: f32Column([40, 100, 160, 220]), v: f32Column(values) },
      encode: { x: { column: 'x' }, y: { column: 'v', scale: 'ys' } }, paint: { fill: { role: 'ink' } },
    }),
  ]);
}
const transformed = (transform: JsonObject): JsonObject => document('closed-167', 'A closed list of transforms', [300, 240], 1, [
  item('dots', 'marks@1', 'b0', {
    mark: 'point', n: 2, key: 'key', columns: { key: strColumn(['a', 'b']), x: f32Column([40, 100]), y: f32Column([40, 100]) },
    transforms: [transform], encode: { x: { column: 'x' }, y: { column: 'y' } }, paint: { fill: { role: 'ink' } },
  }),
]);
const ramped = (range: string[]): JsonObject => document('status-167', 'A ramp over two roles', [300, 240], 1, [
  item('ramp', 'scale@1', 'a0', { type: 'linear', domain: [0, 1], range, nice: false }),
  item('dots', 'marks@1', 'b0', {
    mark: 'point', n: 2, key: 'key', columns: { key: strColumn(['a', 'b']), x: f32Column([40, 100]), v: f32Column([0, 1]) },
    encode: { x: { column: 'x' }, y: 50, role: { column: 'v', scale: 'ramp' } },
  }),
]);
const check = (bin: string, doc: JsonObject, look: JsonValue = LOOK): ReturnType<typeof checked> => checked(lines(bin, 'check', [{ doc, look }])[0], 'check');

describe('the refusals this work adds', () => {
  it('It can never: values ≤ 0 on a log scale are refused, naming those rows', () => {
    const bin = render();
    passes(bin, logDoc([10, 20, 30, 40]), LOOK, 'positive values on a log scale');
    const c = check(bin, logDoc([10, 0, -3, 5]));
    const ids = c.errors.flatMap((e) => e.ids);
    expect(ids, `refused, naming dots#q and dots#r: ${shownIssues(c)}`).toEqual(expect.arrayContaining(['dots#q', 'dots#r']));
    expect(ids.filter((i) => i === 'dots#p' || i === 'dots#s'), 'the positive rows aren\'t named').toEqual([]);
  }, TIMEOUT);

  it('It can never: a transform outside the closed list, such as a regression, is refused', () => {
    const bin = render();
    passes(bin, transformed({ emphasis: { keys: ['a'] } }), LOOK, 'a transform on the list');
    const c = check(bin, transformed({ regression: { by: 'x' } }));
    expect(c.errors.length, `a regression is refused: ${shownIssues(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it('It can never: a linear scale can\'t ramp a column to a status role', () => {
    const bin = render();
    // The clean look holds the status roles, so this refusal can't be an unresolved role.
    const fine = check(bin, ramped(['ink', 'muted']), 'clean');
    expect(fine.errors.map((e) => e.code), `a ramp over the look's roles passes: ${shownIssues(fine)}`).toEqual([]);
    const c = check(bin, ramped(['status.pass', 'status.fail']), 'clean');
    const named = c.errors.filter((e) => e.code !== 'role_unresolved' && (e.ids.includes('ramp') || e.ids.includes('dots')));
    expect(named.length, `a ramp over status roles is refused, naming the scale or the set: ${shownIssues(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it('It can never: a number mixes only from two periods of one key', () => {
    const race = (c2002: number): JsonObject => document('three-167', 'Three periods', [400, 280], 1,
      [...RACE_SCALES, raceBars([[2000, { a: 10, c: 30 }], [2001, { a: 40 }], [2002, { a: 20, c: c2002 }]])], { channels: atChannel(2000, 1) });
    const bin = render();
    const t = fl(0.5);
    const one = rowsAt(bin, race(10), 'race', [t], LOOK)[0]!;
    const other = rowsAt(bin, race(44), 'race', [t], LOOK)[0]!;
    near(column(one['a']!, 'value', 'a'), 25, 1e-4, 'a between 2000 and 2001');
    near(column(one['c']!, 'value', 'c'), 30, 1e-4, 'c, missing from 2001, holds its neighboring period\'s value');
    expect(canonical(other as unknown as JsonValue), 'a later period changes nothing at 2000.5').toBe(canonical(one as unknown as JsonValue));
  }, TIMEOUT);

  it('It can never: rows from an occurrence list take no row after t, played or seeked', () => {
    const doc = document('rows-167', 'Rows from markers', [300, 100], 1, [
      item('hits', 'marks@1', 'a0', {
        mark: 'point', rows: { from: { list: 'markers.cue' } },
        encode: { x: { column: 'v' }, y: 50 }, paint: { fill: { role: 'ink' } },
      }),
    ], { markers: {
      m0: { kind: 'cue', t: '0.25s', payload: { v: 10 } },
      m1: { kind: 'cue', t: '0.5s', payload: { v: 20 } },
      m2: { kind: 'cue', t: '0.75s', payload: { v: 30 } },
    } });
    const bin = render();
    passes(bin, doc, LOOK, 'rows from an occurrence list');
    const rows = rowsAt(bin, doc, 'hits', [0.1, 0.25, 0.6, 0.75, 0.3].map(fl), LOOK);
    expect(rows.map((r) => Object.keys(r).sort()), 'one row per match at or before t, keyed by its index').toEqual([[], ['0'], ['0', '1'], ['0', '1', '2'], ['0']]);
    expect(rows[3]!['2']!.columns['v'], 'a row holds its payload').toBe(30);
    expect(rows[3]!['1']!.columns['flick'], 'a row holds its flick').toBe(fl(0.5));
  }, TIMEOUT);
});

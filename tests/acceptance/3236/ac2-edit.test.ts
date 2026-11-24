// AC2 #3236.00cad6c6: "Changing one row's y to 55 changes the node's value to 2 to 55 at the next check, with no edit
// to any name. A planted tree that keeps the old value fails, naming the column"
//
// The fixture scatter shown, then shown again by the agent with row 0's y changed from 40 to 55 and nothing else (the
// test holds the two documents equal but for that one value): the next check. `see` after each: before, the value
// says y 2 to 40; after, y 2 to 55 (with x 0 to 11, 11 drawn, 1 missing as before), and every node of the tree keeps
// its name. The planted `tree_keeps_old_value` keeps the node's value from the document's first check; the criterion's
// check fails it, naming the column y.
// Wrong programs: a value written once and never recomputed; a value recomputed only when a name changes.
import { describe, expect, it } from 'vitest';
import { DOC, EDITED_ROW, EDITED_Y, SCATTER, scatterDoc } from './fixtures.ts';
import {
  AC, Script, TIMEOUT, binOf, failsNaming, nodeOf, none, prebuild, presented, runShow, scatterValueFailures, scenario, seenOf, show, useTemp,
  type JsonObject, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(2);

/** The two documents equal but for the scatter's y column, which differs only in row EDITED_ROW. */
function onlyTheRowChanged(a: JsonObject, b: JsonObject): void {
  const without = (d: JsonObject): string => { const c = JSON.parse(JSON.stringify(d)) as { items: Record<string, { params: { columns: Record<string, unknown> } }> }; delete c.items[SCATTER]!.params.columns['y']; return JSON.stringify(c); };
  expect(without(b), 'the fixture: the edit changes nothing but the y column').toBe(without(a));
  const ys = (d: JsonObject): Float64Array => {
    const data = ((d['items'] as JsonObject)[SCATTER] as { params: { columns: { y: { data: string } } } }).params.columns.y.data;
    const bytes = Buffer.from(data, 'base64');
    return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.length / 8);
  };
  const [ya, yb] = [ys(a), ys(b)];
  const changed = [...ya].flatMap((v, i) => (Object.is(v, yb[i]) ? [] : [i]));
  expect(changed, 'the fixture: the edit changes one row\'s y').toEqual([EDITED_ROW]);
  expect(yb[EDITED_ROW], 'the fixture: to 55').toBe(EDITED_Y);
}

/** The scatter shown, then shown with row 0's y at 55: the criterion's failures, each about a column starting `column <name>:`. */
function edited(planted?: Planted): string[] {
  const before = scatterDoc(D);
  const after = scatterDoc(D, { edited: true });
  onlyTheRowChanged(before, after);
  const s = new Script();
  s.present(D, before);
  const seenBefore = s.see();
  const next = s.present(D, after);
  const seenAfter = s.see();
  const r = runShow(binOf(), scenario(temp(), [D], s.calls, planted), 'AC2 the scatter and its edit');
  presented(r[0]!, 'the fixture scatter');
  presented(r[next]!, 'the scatter with row 0\'s y at 55');
  const [a, b] = [seenOf(r[seenBefore]!, 'see before the edit'), seenOf(r[seenAfter]!, 'see after the edit')];
  const failures = [
    ...scatterValueFailures(nodeOf(a, SCATTER), [2, 40], 'before the edit'),
    ...scatterValueFailures(nodeOf(b, SCATTER), [2, EDITED_Y], 'at the next check, after row 0\'s y became 55'),
  ];
  // No edit to any name: every node keeps its name across the edit.
  const names = (t: JsonObject[]): string => show(t.map((n) => [n['id'], n['name']]), 4000);
  if (names(a.tree) !== names(b.tree)) failures.push(`a node's name changed with the edit: before ${names(a.tree)}, after ${names(b.tree)}`);
  return failures;
}

describe(`${AC[2]} the node's value follows the data at the next check, with no name edited`, () => {
  it(`${AC[2]} changing one row's y to 55 changes the node's value to 2 to 55 at the next check, with no edit to any name`, () => {
    none(edited(), 'the value after the edit');
  }, TIMEOUT);

  it(`${AC[2]} planted tree_keeps_old_value fails, naming the column`, () => {
    failsNaming(edited('tree_keeps_old_value'), [/^column y:/, /2 to 55/], 'the tree that keeps the old value');
  }, TIMEOUT);
});

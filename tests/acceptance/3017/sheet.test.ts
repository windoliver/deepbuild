// #3017.2b3c94b2 (AC7): "A contact sheet of six views returns six tables, and an item one view hides is in that view's
// `hidden` and in no other's"
//
// Fixture (helpers.ts `sheetScene`, README: Fixtures): a 0.5 m cube at the origin and a 2.4 m square screen 0.1 m thick
// 1 m behind it (−Z). The sheet's views orbit the bounds' centre: back looks along +Z through the screen, which covers
// the cube whole; front, left, right, top and three-quarter see the cube, the screen behind it or edge-on beside it.
// In one `deep-show run`: alpha's deep_show of it (pixels at 640 × 360), then render-back of that revision with
// `sheet: {views: [front, back, left, right, top, three_quarter]}` at 640 × 360.
//
// asserts:
//   - the sheet returns six snapshots, one a view; each carries its own table: `visible` rows `{id, box, px, at}`
//     with `hidden` beside them;
//   - the back view's `hidden` lists the cube and its `visible` doesn't; no other view's `hidden` lists the cube.
// Wrong programs: the base (each view's rows from boxes, no `hidden`); one table for the whole sheet, or every view's
// table read from one view's picks; hidden items pooled across views.
import { describe, expect, it } from 'vitest';
import {
  CUBE, HIDING_VIEW, SHEET_SIZE, TIMEOUT, VIEWS, docId, none, proof, renderBack, requireMetal, rowOf, run, scenarioOf, shapeFailures, sheetScene, show,
  snapshotsOf, tableOf, useBuild, useFolders, type Table,
} from './helpers.ts';

/** The criterion's ID: `#3017.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const AC7 = '#3017.2b3c94b2';
const bin = useBuild();
const folder = useFolders();
const DOC = docId(8);
/** The revision a fresh scenario's first deep_show of a document mints. */
const FIRST_REV = 1;

describe(`${AC7} a contact sheet's views each carry their own table`, () => {
  it(`${AC7} a sheet of six views returns six tables, and the cube the back view hides is in that view's hidden and in no other's`, () => {
    requireMetal('render-back of the sheet');
    const [shown, sheet] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, sheetScene(), SHEET_SIZE), renderBack(DOC, FIRST_REV, SHEET_SIZE, { sheet: { views: [...VIEWS] } })]));
    expect(shown!['rev'], `the deep_show minted revision ${FIRST_REV}, which the sheet draws`).toBe(FIRST_REV);
    const snaps = snapshotsOf(sheet!, 'the contact sheet');
    expect(snaps.map((s) => s['view']).sort(), 'the sheet returns one snapshot for each of the six views').toEqual([...VIEWS].sort());
    const tables = new Map<string, Table>(snaps.map((s) => [String(s['view']), tableOf(s, `the sheet's ${String(s['view'])} view`)]));
    proof('the sheet\'s six tables', Object.fromEntries([...tables].map(([v, t]) => [v, { visible: t.rows.map((r) => ({ id: r.id, px: r.px ?? null, at: r.at ?? null })), hidden: t.hidden }])));
    const failures: string[] = [];
    for (const [view, t] of tables) failures.push(...shapeFailures(t, SHEET_SIZE, `the ${view} view's table`));
    const back = tables.get(HIDING_VIEW)!;
    if (!back.hidden.includes(CUBE)) failures.push(`the ${HIDING_VIEW} view, whose screen covers the cube, doesn't list the cube under hidden (hidden: ${back.hiddenGiven ? back.hidden.join(', ') : 'absent'})`);
    if (rowOf(back, CUBE)) failures.push(`the ${HIDING_VIEW} view, whose screen covers the cube, lists the cube as a row of visible`);
    for (const [view, t] of tables) if (view !== HIDING_VIEW && t.hidden.includes(CUBE)) failures.push(`the ${view} view, which shows the cube, lists it under hidden`);
    none(failures, 'each view carries its own table, and only the back view hides the cube');
  }, TIMEOUT);
});

// #3017.68944217 (AC6): "A cutaway that removes an item's whole shape moves the item from `visible` to `hidden`. A planted
// table that counts picks from the frame before the cutaway fails, naming the item"
//
// Fixture (helpers.ts `cutaway`, README: Fixtures): an orthographic camera level on +Z, 60 px a metre, 960 × 540; a
// vase (60 × 120 px) spanning x 2 m to 3 m and a stand (120 × 120 px) spanning x −3 m to −1 m. Its first revision has no
// cutaway; its second adds `section`, a `cutaway@1` (view class, applying to all) whose one plane hides x > 1 m: the
// vase's whole shape, and none of the stand. In one `deep-show run`: alpha's deep_show of the first revision, then of
// the second, of the same document, pixels at 960 × 540.
//
// asserts:
//   - before the cutaway the vase is a row of `visible` and not under `hidden`; with it the vase is no row of `visible`
//     and `hidden` lists it; the stand is a row of both (the fixture: the plane leaves it).
//   - planted `visible_picks_before_cutaway`: the judge fails, naming the vase.
// Wrong programs: the base (a row from the box, which a cutaway doesn't change); picks counted from the frame drawn
// before the cutaway (`visible_picks_before_cutaway`); an item a cutaway reaches dropped from the reply altogether.
import { describe, expect, it } from 'vitest';
import {
  CUT_SIZE, STAND, TIMEOUT, VASE, brief, cutaway, docId, none, proof, requireMetal, rowOf, run, scenarioOf, show, snapshotsOf, tableOf, useBuild,
  useFolders, type Table,
} from './helpers.ts';

/** The criterion's ID: `#3017.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const AC6 = '#3017.68944217';
/** The wrong program the criterion names (README: The planted programs). */
const BEFORE_CUT = 'visible_picks_before_cutaway';
const bin = useBuild();
const folder = useFolders();
const DOC = docId(7);

/** The document's two revisions shown under `planted`: the table before the cutaway and with it. */
function shown(planted?: string): { before: Table; after: Table } {
  const replies = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, cutaway(false), CUT_SIZE), show(DOC, cutaway(true), CUT_SIZE)], planted));
  const [before, after] = replies.map((r, i) => {
    const what = `the vase and the stand ${i === 0 ? 'before the cutaway' : 'with the cutaway'}${planted ? ` under ${planted}` : ''}`;
    expect(snapshotsOf(r, what).map((s) => [s['w'], s['h']]), `${what} returns one snapshot of 960 × 540 px`).toEqual([[CUT_SIZE[0], CUT_SIZE[1]]]);
    return tableOf(r, what);
  });
  expect(replies[1]!['rev'], 'the cutaway is a later revision of the same document').not.toBe(replies[0]!['rev']);
  return { before: before!, after: after! };
}

/** The criterion's judge: the vase moves from visible to hidden once the cutaway removes its whole shape. */
function moveFailures(before: Table, after: Table): string[] {
  const f: string[] = [];
  if (!rowOf(before, VASE)) f.push(`before the cutaway the vase, which shows, is no row of visible (rows: ${before.rows.map((r) => r.id).join(', ')})`);
  if (before.hidden.includes(VASE)) f.push('before the cutaway hidden lists the vase, which shows');
  const row = rowOf(after, VASE);
  if (row) f.push(`with the cutaway removing its whole shape, the vase is still a row of visible: ${brief(row as never, 200)}`);
  if (!after.hidden.includes(VASE)) f.push(`with the cutaway removing its whole shape, hidden doesn't list the vase (hidden: ${after.hiddenGiven ? brief(after.hidden) : 'absent'})`);
  for (const [t, when] of [[before, 'before the cutaway'], [after, 'with the cutaway']] as const) {
    if (!rowOf(t, STAND)) f.push(`${when} the stand, which the plane leaves whole, is no row of visible`);
  }
  return f;
}

describe(`${AC6} a cutaway moves the item it removes from visible to hidden`, () => {
  it(`${AC6} a cutaway that removes the vase's whole shape moves it from visible to hidden`, () => {
    requireMetal('render-back of the cutaway');
    const { before, after } = shown();
    proof('the vase\'s tables before the cutaway and with it', {
      before: { visible: before.rows.map((r) => ({ id: r.id, px: r.px ?? null })), hidden: before.hidden },
      after: { visible: after.rows.map((r) => ({ id: r.id, px: r.px ?? null })), hidden: after.hidden },
    });
    none(moveFailures(before, after), 'the cutaway moves the vase from visible to hidden');
  }, TIMEOUT);

  it(`${AC6} a planted table that counts picks from the frame before the cutaway (planted ${BEFORE_CUT}) fails, naming the vase`, () => {
    requireMetal('render-back of the cutaway');
    const { before, after } = shown(BEFORE_CUT);
    const failures = moveFailures(before, after);
    proof(`under ${BEFORE_CUT}: the judge's failures`, failures);
    expect(failures.length, `under ${BEFORE_CUT} the judge fails`).toBeGreaterThan(0);
    expect(failures.some((x) => x.startsWith('with the cutaway') && x.includes('vase')), `under ${BEFORE_CUT} the judge fails naming the vase: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});

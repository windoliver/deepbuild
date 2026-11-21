// #3017.5f877f6f (AC5): "A frame of 1,000 boxes in view, 300 of them large and near, returns 200 rows that are the 200
// with the most px, sorted by ID, and `cut.visible` is 800. A planted table that keeps the first 200 by ID fails, naming a
// row it kept and a larger one it dropped. A planted table that cuts and reports no `cut` fails, naming the count"
//
// Fixture (helpers.ts `grid`, README: Fixtures): an orthographic camera level on +Z, 20 px a metre, 960 × 540; 1,000
// boxes `box-000` to `box-999`, box k centred in cell (k mod 40, ⌊k ÷ 40⌋) of a 40 × 25 grid of 24 × 20 px cells, so
// none hides another. 300 are large and 1 m nearer the camera: the 200 with k mod 5 = 4 draw 18 × 18 = 324 px, the
// 100 with k mod 10 = 2 draw 14 × 14 = 196 px; the other 700 draw 4 × 4 = 16 px. So the 200 with the most px are
// exactly the 200 of 324 px, with no tie at the cut, and the first 200 by ID (box-000 to box-199) hold 140 small ones.
// One `deep-show run` each: alpha's deep_show of it, pixels at 960 × 540, under no plant and under each planted table.
//
// asserts:
//   - `visible` holds 200 rows, sorted by ID, and they are the 200 of 324 px; nothing is hidden; `cut.visible` is 800
//     (and `cut.hidden`, where given, 0).
//   - planted `visible_first_200_by_id`: the judge fails, naming a row it kept and a larger one it dropped.
//   - planted `visible_cut_unreported`: the judge fails, naming the count, 800.
// Wrong programs: the base (the first 200 by ID, no px, no `cut`); the first 200 by ID (`visible_first_200_by_id`); a
// cut with no `cut` (`visible_cut_unreported`); a cut that keeps the fewest px, or 200 rows left in px order.
import { describe, expect, it } from 'vitest';
import {
  BOXES, GRID_SIZE, TIMEOUT, boxId, brief, docId, grid, gridPx, isObject, none, proof, requireMetal, run, scenarioOf, show, snapshotsOf, tableOf,
  useBuild, useFolders, type Table,
} from './helpers.ts';

/** The criterion's ID: `#3017.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const AC5 = '#3017.5f877f6f';
/** The wrong programs the criterion names (README: The planted programs). */
const FIRST_BY_ID = 'visible_first_200_by_id';
const NO_CUT = 'visible_cut_unreported';
const bin = useBuild();
const folder = useFolders();
const DOC = docId(6);
const KEPT = 200;

/** Each box's px from its face, by ID; the 200 with the most, which the table must keep (no tie at the cut). */
const PX = new Map(Array.from({ length: BOXES }, (_, k) => [boxId(k), gridPx(k)] as const));
const MOST: string[] = [...PX.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, KEPT).map(([id]) => id).sort();
const THRESHOLD = PX.get(MOST[MOST.length - 1]!)!;

/** The thousand boxes shown under `planted`: the reply's table. */
function shown(planted?: string): Table {
  const what = `the thousand boxes shown at 960 × 540${planted ? ` under ${planted}` : ''}`;
  const [reply] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, grid(GRID_SIZE), GRID_SIZE)], planted));
  expect(snapshotsOf(reply!, what).map((s) => [s['w'], s['h']]), `${what} returns one snapshot of 960 × 540 px`).toEqual([[GRID_SIZE[0], GRID_SIZE[1]]]);
  return tableOf(reply!, what);
}

/** The criterion's judge. A kept row and a dropped one are named with each one's px (from its face); the count is named. */
function cutFailures(t: Table): string[] {
  const f: string[] = [];
  const ids = t.rows.map((r) => r.id);
  const kept = new Set(ids);
  const intruders = ids.filter((id) => !MOST.includes(id)).sort((a, b) => (PX.get(a) ?? 0) - (PX.get(b) ?? 0) || a.localeCompare(b));
  const dropped = MOST.filter((id) => !kept.has(id));
  if (intruders.length > 0 && dropped.length > 0) {
    f.push(`visible kept ${intruders[0]} (${PX.get(intruders[0]!) ?? '?'} px) and dropped ${dropped[0]} (${PX.get(dropped[0]!)} px), a larger one: ${intruders.length} rows kept are not among the 200 with the most px`);
  } else if (dropped.length > 0) {
    f.push(`visible dropped ${dropped.length} of the 200 with the most px, ${dropped[0]} (${PX.get(dropped[0]!)} px) among them`);
  } else if (intruders.length > 0) {
    f.push(`visible kept ${intruders.length} rows not among the 200 with the most px, ${intruders[0]} (${PX.get(intruders[0]!) ?? '?'} px) among them`);
  }
  if (ids.length !== KEPT) f.push(`visible holds ${ids.length} rows, not ${KEPT}`);
  const sorted = [...ids].sort();
  if (ids.join() !== sorted.join() || new Set(ids).size !== ids.length) f.push(`visible's rows aren't sorted by ID, each once: ${ids.slice(0, 12).join(', ')}…`);
  if (t.hidden.length > 0) f.push(`hidden lists ${t.hidden.length} boxes, though every box shows: ${t.hidden.slice(0, 5).join(', ')}`);
  const cut = t.cut;
  if (!isObject(cut)) f.push(`cut is ${cut === undefined ? 'absent' : brief(cut, 120)}, where ${BOXES - KEPT} of the ${BOXES} visible boxes were left out of the table`);
  else {
    if (cut['visible'] !== BOXES - KEPT) f.push(`cut.visible is ${brief(cut['visible'], 40)}, not ${BOXES - KEPT}: ${BOXES} boxes show and the table keeps ${KEPT}`);
    if (cut['hidden'] !== undefined && cut['hidden'] !== 0) f.push(`cut.hidden is ${brief(cut['hidden'], 40)}, though no box is hidden`);
  }
  return f;
}

describe(`${AC5} a frame of 1,000 boxes keeps the 200 with the most px and says what it cut`, () => {
  it(`${AC5} 1,000 boxes in view, 300 large and near: 200 rows, the 200 with the most px, sorted by ID, and cut.visible 800`, () => {
    requireMetal('render-back of the thousand boxes');
    const t = shown();
    proof('the thousand boxes\' table', { rows: t.rows.length, first: t.rows.slice(0, 5).map((r) => ({ id: r.id, px: r.px ?? null })), cut: t.cut ?? null, hidden: t.hidden.length, least_kept_px: THRESHOLD });
    none(cutFailures(t), 'the table keeps the 200 with the most px, sorted by ID, and says it left out 800');
  }, TIMEOUT);

  it(`${AC5} a planted table that keeps the first 200 by ID (planted ${FIRST_BY_ID}) fails, naming a row it kept and a larger one it dropped`, () => {
    requireMetal('render-back of the thousand boxes');
    const failures = cutFailures(shown(FIRST_BY_ID));
    proof(`under ${FIRST_BY_ID}: the judge's failures`, failures);
    const named = failures.map((x) => /^visible kept (box-\d{3}) \(\d+ px\) and dropped (box-\d{3}) \(\d+ px\)/.exec(x)).find((m) => m !== null);
    expect(named, `under ${FIRST_BY_ID} the judge names a row kept and one dropped: ${failures.join(' | ')}`).toBeTruthy();
    expect(PX.get(named![2]!)!, `under ${FIRST_BY_ID} the dropped row ${named![2]} is larger than the kept ${named![1]}`).toBeGreaterThan(PX.get(named![1]!)!);
  }, TIMEOUT);

  it(`${AC5} a planted table that cuts and reports no cut (planted ${NO_CUT}) fails, naming the count`, () => {
    requireMetal('render-back of the thousand boxes');
    const t = shown(NO_CUT);
    const failures = cutFailures(t);
    proof(`under ${NO_CUT}: the judge's failures`, failures);
    expect(t.rows.length, `under ${NO_CUT} the table still cuts to ${KEPT} rows`).toBe(KEPT);
    expect(failures.some((x) => x.startsWith('cut is absent') && x.includes(String(BOXES - KEPT))), `under ${NO_CUT} the judge fails naming the count, ${BOXES - KEPT}: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});

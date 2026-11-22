// #3017.cdc4bd52 (AC4): "A wall seen through a doorway 1 m wide reports at most the doorway's px, and the same wall with
// the near wall removed reports more than ten times that. On the merge base the two rows are equal"
//
// Fixture (helpers.ts `doorway`, README: Fixtures): an orthographic camera level on +Z, 60 px a metre, 960 × 540; a far
// wall 12 × 6 m (720 × 360 px) 3 m behind a near wall of three parts round a doorway 1 m (60 px) wide, from its lintel
// to the frame's bottom edge: the doorway is 60 × 330 = 19,800 px of the frame. The same document with the near wall's
// three parts removed is the second. In one `deep-show run`: alpha's deep_show of each, pixels at 960 × 540.
//
// asserts:
//   - the far wall is a row of both tables; through the doorway its px is at most the doorway's 19,800, and above 0
//     (it shows there); with the near wall removed its px is more than ten times the px it reported through the
//     doorway; the two rows are not equal.
//   - planted `visible_table_as_boxes` (the merge base's table, README: The planted programs) fails the same judge, the
//     two rows equal.
// Wrong programs: the base (a row from the box alone, so the wall through the doorway and the wall in full read the
// same); px from the box's area; px counted before the near wall hides most of the far wall.
import { describe, expect, it } from 'vitest';
import {
  DOOR_SIZE, DOORWAY, FAR_WALL, TIMEOUT, areaOf, brief, docId, doorway, none, proof, pxOf, requireMetal, rowOf, run, scenarioOf, show, snapshotsOf,
  tableOf, useBuild, useFolders, type JsonObject, type Row,
} from './helpers.ts';

/** The criterion's ID: `#3017.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const AC4 = '#3017.cdc4bd52';
/** The merge base's table, as a planted program (README: The planted programs). */
const AS_BOXES = 'visible_table_as_boxes';
const bin = useBuild();
const folder = useFolders();
const [THROUGH, WHOLE] = [docId(4), docId(5)];
/** The doorway's px in the frame: 60 × 330. */
const DOORWAY_PX = areaOf(DOORWAY);

/** Both documents shown in one run under `planted`: the far wall's row in each table. */
function rows(planted?: string): { through: Row | undefined; whole: Row | undefined; replies: JsonObject[] } {
  const replies = run(bin(), scenarioOf(folder(), [THROUGH, WHOLE], [show(THROUGH, doorway(true), DOOR_SIZE), show(WHOLE, doorway(false), DOOR_SIZE)], planted));
  const [a, b] = replies.map((r, i) => {
    const what = `the far wall ${i === 0 ? 'through the doorway' : 'with the near wall removed'}${planted ? ` under ${planted}` : ''}`;
    expect(snapshotsOf(r, what).map((s) => [s['w'], s['h']]), `${what} returns one snapshot of 960 × 540 px`).toEqual([[DOOR_SIZE[0], DOOR_SIZE[1]]]);
    return rowOf(tableOf(r, what), FAR_WALL);
  });
  return { through: a, whole: b, replies };
}

/** The criterion's judge on the far wall's two rows. */
function wallFailures(through: Row | undefined, whole: Row | undefined): string[] {
  const f: string[] = [];
  const show = (r: Row | undefined): string => brief(r as unknown as JsonObject, 200);
  if (through && whole && JSON.stringify(through) === JSON.stringify(whole)) f.push(`the far wall's row through the doorway and its row with the near wall removed are equal: ${show(through)}`);
  if (!through) { f.push('the far wall, which shows through the doorway, is no row of visible'); return f; }
  if (!whole) { f.push('the far wall, with nothing in front of it, is no row of visible'); return f; }
  const [a, b] = [pxOf(through), pxOf(whole)];
  if (a === null) f.push(`the far wall's row through the doorway reports px ${brief(through.px, 60)}, not a count`);
  else if (a > DOORWAY_PX) f.push(`the far wall seen through the doorway reports ${a} px, more than the doorway's ${DOORWAY_PX}`);
  if (b === null) f.push(`the far wall's row with the near wall removed reports px ${brief(whole.px, 60)}, not a count`);
  else if (a !== null && !(b > 10 * a)) f.push(`the far wall with the near wall removed reports ${b} px, not more than ten times the ${a} it reports through the doorway`);
  return f;
}

describe(`${AC4} a wall through a doorway reports what shows of it`, () => {
  it(`${AC4} the far wall through a 1 m doorway reports at most the doorway's px, and with the near wall removed more than ten times that`, () => {
    requireMetal('render-back of the doorway');
    const { through, whole } = rows();
    proof('the far wall\'s rows: through the doorway, and with the near wall removed', { doorway_px: DOORWAY_PX, through: (through ?? null) as unknown as JsonObject, whole: (whole ?? null) as unknown as JsonObject });
    none(wallFailures(through, whole), 'the far wall\'s px says how much of it shows');
  }, TIMEOUT);

  it(`${AC4} the merge base's table (planted ${AS_BOXES}) reports the two rows equal and fails`, () => {
    requireMetal('render-back of the doorway');
    const { through, whole } = rows(AS_BOXES);
    const failures = wallFailures(through, whole);
    proof(`under ${AS_BOXES}: the judge's failures`, failures);
    expect(failures.some((x) => x.includes('are equal')), `under ${AS_BOXES} the judge fails on two equal rows: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});

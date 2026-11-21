// #3017.0d5e9e4a (AC1): "A fixture room: a table in plain view, a chair wholly behind a wall, and a lamp half behind a
// pillar, rendered back at 960 × 540. `visible` lists the table and the lamp and not the chair, and `hidden` lists the
// chair. On the merge base the chair is a row of `visible`, and the test fails, naming it"
// #3017.f9dbec77 (AC2): "The lamp's `px` is the count of the snapshot's pixels whose pick resolves to the lamp, exactly,
// counted by the test from the same frame's object-ID pass. A planted table that counts the px of the lamp's box reports
// more than that and fails, naming the item and both counts"
// #3017.4a9dce0e (AC3): "Each row's `at` is a pixel whose pick resolves to that row's item, and a probe at `at` returns
// the item first. A planted table that reports the box's centre puts the lamp's `at` on the pillar and fails, naming the
// item"
//
// Fixture (helpers.ts `room`, README: Fixtures): an orthographic camera level on +Z, 60 px a metre, 960 × 540; a table
// (120 × 60 px) in plain view; a chair (60 × 90 px) 2 m behind a wall whose face covers it whole; a lamp (30 × 60 px)
// 2 m behind a pillar that covers its right 16 columns, its box's centre among them. Every edge on a px boundary.
// Runs (one `deep-show run` each): the room shown (alpha's deep_show of it, pixels at 960 × 540), which teaches the
// rows' `at`; then the room shown again, and on that revision render-back probes every px of the lamp's face grown by
// 2 px (the lamp's picks, 64 a call) and each row's `at` from the first run.
//
// asserts:
//   - AC1: the chair is not a row of `visible`; the table and the lamp are; `hidden` lists the chair. Planted
//     `visible_table_as_boxes` (the merge base's table, README: The planted programs) fails naming the chair.
//   - AC2: the lamp's row's `px` is exactly the count of probed px whose pick resolves to the lamp, on the same picture
//     (the probes' snapshot is the deep_show's SHA-256); the probes cover every px the lamp drew (none in the grown
//     ring). Planted `visible_px_from_box` reports more and fails, the failure naming the lamp and both counts.
//   - AC3: each row's `at` is a px of the frame, and a probe there, on the same picture, returns the row's item first.
//     Planted `visible_at_box_centre` puts the lamp's `at` on the pillar and fails, naming the lamp.
// Wrong programs: the base (a row from each box that meets the frame, so the chair; no px, no at, no hidden); a table
// from boxes (`visible_table_as_boxes`); px from the box's area (`visible_px_from_box`); px from another frame or with
// the part behind the pillar counted; `at` at the box's centre (`visible_at_box_centre`) or anywhere not on the item.
import { describe, expect, it } from 'vitest';
import {
  CHAIR, LAMP, PILLAR, ROOM, ROOM_SIZE, TABLE, TIMEOUT, atOf, brief, countOf, docId, none, once, pickAt, picksOf, probeCalls, proof, pxIn,
  pxOf, requireMetal, room, rowOf, run, scenarioOf, show, snapshotsOf, tableOf, useBuild, useFolders, type JsonObject, type Px, type Table,
} from './helpers.ts';

/** The criteria's IDs: `#3017.` and the first 8 hex digits of SHA-256 of each one's text (scripts/proof-change.mjs). */
const AC1 = '#3017.0d5e9e4a';
const AC2 = '#3017.f9dbec77';
const AC3 = '#3017.4a9dce0e';
/** The wrong programs the criteria name (README: The planted programs). */
const AS_BOXES = 'visible_table_as_boxes';
const PX_FROM_BOX = 'visible_px_from_box';
const AT_BOX_CENTRE = 'visible_at_box_centre';

const bin = useBuild();
const folder = useFolders();
const DOC = docId(1);
const doc = room();
/** Every px of the lamp's face, grown by 2 px: the lamp draws nowhere else, so this holds each px its pick can name. */
const GROW = 2;
const LAMP_PX: Px[] = pxIn(ROOM[LAMP]!.rect, ROOM_SIZE, GROW);

/** The room shown at 960 × 540 under `planted`: its reply, its table, its revision and its picture. */
interface Shown { reply: JsonObject; table: Table; rev: number; sha: string }
function shownOf(reply: JsonObject, what: string): Shown {
  const snaps = snapshotsOf(reply, what);
  expect(snaps.map((s) => [s['w'], s['h']]), `${what} returns one snapshot of 960 × 540 px`).toEqual([[ROOM_SIZE[0], ROOM_SIZE[1]]]);
  expect(typeof reply['rev'], `${what} names its revision`).toBe('number');
  return { reply, table: tableOf(reply, what), rev: reply['rev'] as number, sha: String(snaps[0]!['sha256']) };
}
/** One run: the room shown, then on the revision it minted (`rev`, the first one a fresh scenario mints) render-back probing `points`. */
function showAndProbe(rev: number, points: readonly Px[], planted?: string): { shown: Shown; picks: Map<string, string> } {
  const what = `the room shown at 960 × 540${planted ? ` under ${planted}` : ''}`;
  const [first, ...probes] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, doc, ROOM_SIZE), ...probeCalls(DOC, rev, ROOM_SIZE, points)], planted));
  const shown = shownOf(first!, what);
  expect(shown.rev, `${what} minted revision ${rev}, which the probes ask about`).toBe(rev);
  return { shown, picks: picksOf(probes, points, shown.sha, `${what}: the probes`) };
}
const showOnly = (planted?: string): Shown =>
  shownOf(run(bin(), scenarioOf(folder(), [DOC], [show(DOC, doc, ROOM_SIZE)], planted))[0]!, `the room shown at 960 × 540${planted ? ` under ${planted}` : ''}`);
/** Each row's `at`, where it is a px of the frame. */
const atsOf = (t: Table): Px[] => t.rows.map((r) => atOf(r, ROOM_SIZE)).filter((a): a is Px => a !== null);

/** The shipped program's runs: the room shown once (its rows' `at`), then shown again with the lamp's px and each `at` probed. */
const taught = once(() => showOnly());
const probed = once(() => { const t = taught(); return showAndProbe(t.rev, [...LAMP_PX, ...atsOf(t.table)]); });

/** AC1's judge: why the room's table doesn't list the table and the lamp, and the chair under `hidden` only. The chair comes first. */
function roomFailures(t: Table): string[] {
  const f: string[] = [];
  const chair = rowOf(t, CHAIR);
  if (chair) f.push(`the chair, wholly behind the wall, is a row of visible: ${brief(chair as unknown as JsonObject, 300)}`);
  for (const id of [TABLE, LAMP]) if (!rowOf(t, id)) f.push(`visible doesn't list the ${id}, which shows (rows: ${t.rows.map((r) => r.id).join(', ')})`);
  if (!t.hidden.includes(CHAIR)) f.push(`hidden doesn't list the chair (hidden: ${t.hiddenGiven ? brief(t.hidden) : 'absent'})`);
  return f;
}

/** AC2's judge: why the lamp's row's px isn't the count of px whose pick resolves to the lamp; each failure names the lamp and both counts. */
function lampPxFailures(t: Table, picks: Map<string, string>): { failures: string[]; reported: number | null; counted: number } {
  const counted = countOf(picks, LAMP);
  const ring = LAMP_PX.filter(([x, y]) => pickAt(picks, [x, y]) === LAMP && !(x >= ROOM[LAMP]!.rect[0] && x < ROOM[LAMP]!.rect[2] && y >= ROOM[LAMP]!.rect[1] && y < ROOM[LAMP]!.rect[3]));
  // The fixture: the lamp shows, and no px it drew lies outside its face, so the probes counted all of them.
  expect(counted, 'the room: some px of the frame resolve to the lamp, which shows left of the pillar').toBeGreaterThan(0);
  expect(ring, 'the room: the lamp draws no px outside its face, so the probed px hold every px it drew').toEqual([]);
  const lamp = rowOf(t, LAMP);
  if (!lamp) return { failures: [`the lamp is no row of visible, so it reports no px; the frame's picks resolve ${counted} px to it`], reported: null, counted };
  const reported = pxOf(lamp);
  if (reported === null) return { failures: [`the lamp's row reports px ${brief(lamp.px, 60)}, not a count; the frame's picks resolve ${counted} px to it`], reported, counted };
  return { failures: reported === counted ? [] : [`the lamp's row reports px ${reported}, where the frame's picks resolve ${counted} px to the lamp`], reported, counted };
}

/** AC3's judge: why a row's `at` isn't a px whose pick, probed on the same picture, resolves to the row's item first; rows whose `at` wasn't probed are left out. */
function atFailures(t: Table, picks: Map<string, string>): string[] {
  const f: string[] = [];
  for (const r of t.rows) {
    const at = atOf(r, ROOM_SIZE);
    if (!at) { f.push(`the ${r.id}'s row carries no at that is a px of the 960 × 540 frame (at ${brief(r.at, 80)})`); continue; }
    const first = pickAt(picks, at);
    if (first === undefined) continue;
    if (first !== r.id) f.push(`the ${r.id}'s at [${at.join(', ')}] is on ${first === '' ? 'no item' : `the ${first}`}: a probe there returns ${first === '' ? 'no hit' : `${first} first`}, not the ${r.id}`);
  }
  return f;
}

describe(`${AC1} ${AC2} ${AC3} the room's table reads the frame's object-ID pass`, () => {
  it(`${AC1} the room rendered back at 960 × 540 lists the table and the lamp in visible and not the chair, and the chair under hidden`, () => {
    requireMetal('render-back of the room');
    const { table, reply } = taught();
    proof('the room\'s table', { visible: reply['visible'] ?? null, hidden: reply['hidden'] ?? null, cut: reply['cut'] ?? null });
    none(roomFailures(table), 'the room\'s table lists what shows and names the chair hidden');
  }, TIMEOUT);

  it(`${AC1} the merge base's table (planted ${AS_BOXES}) lists the chair as a row of visible and fails, naming it`, () => {
    requireMetal('render-back of the room');
    const failures = roomFailures(showOnly(AS_BOXES).table);
    proof(`under ${AS_BOXES}: the judge's failures`, failures);
    expect(failures[0] ?? '', `under ${AS_BOXES} the judge fails first on the chair, naming it`).toMatch(/^the chair, wholly behind the wall, is a row of visible/);
  }, TIMEOUT);

  it(`${AC2} the lamp's px is exactly the count of the snapshot's px whose pick resolves to the lamp, from the same frame's object-ID pass`, () => {
    requireMetal('render-back of the room');
    const { shown, picks } = probed();
    const { failures, reported, counted } = lampPxFailures(shown.table, picks);
    proof('the room\'s rows beside the frame\'s picks', {
      snapshot: shown.sha, lamp_box: rowOf(shown.table, LAMP)?.box ?? null, lamp_px: reported, lamp_picks: counted,
      rows: shown.table.rows.map((r) => ({ id: r.id, box: r.box, px: r.px ?? null, at: r.at ?? null })),
    });
    none(failures, 'the lamp\'s px is the frame\'s count of the lamp\'s picks');
  }, TIMEOUT);

  it(`${AC2} a planted table that counts the px of the lamp's box (planted ${PX_FROM_BOX}) reports more than the frame's picks and fails, naming the lamp and both counts`, () => {
    requireMetal('render-back of the room');
    const { shown, picks } = showAndProbe(taught().rev, LAMP_PX, PX_FROM_BOX);
    const { failures, reported, counted } = lampPxFailures(shown.table, picks);
    proof(`under ${PX_FROM_BOX}: the lamp's px beside the frame's picks`, { lamp_px: reported, lamp_picks: counted, failures });
    expect(reported, `under ${PX_FROM_BOX} the lamp's row reports a px count`).not.toBeNull();
    expect(reported!, `under ${PX_FROM_BOX} the lamp's row reports more px than the frame's picks resolve to it`).toBeGreaterThan(counted);
    expect(failures.length, `under ${PX_FROM_BOX} the judge fails`).toBeGreaterThan(0);
    expect(failures.filter((x) => !(x.includes('lamp') && x.includes(String(reported)) && x.includes(String(counted)))), `under ${PX_FROM_BOX} every failure names the lamp, ${reported} and ${counted}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC3} each row's at is a px whose pick resolves to the row's item, and a probe at it returns the item first`, () => {
    requireMetal('render-back of the room');
    const t = taught();
    const { shown, picks } = probed();
    expect(shown.sha, 'the probes read the picture the taught table is of (one SHA-256)').toBe(t.sha);
    const unprobed = t.table.rows.filter((r) => { const a = atOf(r, ROOM_SIZE); return a !== null && pickAt(picks, a) === undefined; });
    expect(unprobed.map((r) => r.id), 'each row\'s at was probed').toEqual([]);
    proof('the room\'s rows\' at and what a probe there returns first', t.table.rows.map((r) => {
      const a = atOf(r, ROOM_SIZE);
      return { id: r.id, at: r.at ?? null, first: a ? pickAt(picks, a) ?? null : null };
    }));
    none(atFailures(t.table, picks), 'each row\'s at is on its item');
  }, TIMEOUT);

  it(`${AC3} a planted table that reports the box's centre (planted ${AT_BOX_CENTRE}) puts the lamp's at on the pillar and fails, naming the lamp`, () => {
    requireMetal('render-back of the room');
    const planted = showOnly(AT_BOX_CENTRE);
    const { shown, picks } = showAndProbe(planted.rev, atsOf(planted.table), AT_BOX_CENTRE);
    expect(shown.sha, `under ${AT_BOX_CENTRE} the probes read the picture the planted table is of`).toBe(planted.sha);
    const failures = atFailures(planted.table, picks);
    const lamp = rowOf(planted.table, LAMP);
    const at = lamp ? atOf(lamp, ROOM_SIZE) : null;
    proof(`under ${AT_BOX_CENTRE}: the lamp's at and the judge's failures`, { lamp_at: lamp?.at ?? null, first: at ? pickAt(picks, at) ?? null : null, failures });
    expect(at ? pickAt(picks, at) : null, `under ${AT_BOX_CENTRE} the lamp's at is on the pillar`).toBe(PILLAR);
    expect(failures.some((x) => x.startsWith(`the ${LAMP}'s at`)), `under ${AT_BOX_CENTRE} the judge fails naming the lamp: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});

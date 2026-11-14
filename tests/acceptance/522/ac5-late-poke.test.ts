// #522.cc560b9c: "A ball dropped onto a floor first touches it at step 250, and the track holds a sideways poke at step
// 252; a test writer that adds an upward poke at step 240 only after the world has run to step 256, so the world
// restores its checkpoint at step 240 and steps to 256 again, gives the same step hashes from step 240 on and the same
// occurrence lists as a run that had both pokes from the start, with no contact at step 250; a planted restore that keeps
// the replaced steps' occurrences fails, naming that contact, and one that forks at the late poke and drops the poke at
// step 252 fails, naming that step"
//
// The drop (README: Worlds): a 0.1 m ball at rest 21.16 m up, over a floor whose top is y = 0, a checkpoint every 60
// steps. A live view of it with the sideways poke (+2 m/s along x) on its track, no bake, over 4 s: a seek frame to
// step 256 runs it there; this test is the writer that then adds the upward poke (+25 m/s along y) stamped at step 240
// (a `late` entry, README: `frame`), and frames run until the playhead's step 256 shows again; a seek to step 480 runs
// on, and `record` reads what the world holds. The run that had both pokes from the start is a straight bake of the
// same world with both on its track, 480 steps. The judge names the first thing that differs: an occurrence the
// session keeps that the straight run doesn't make, or one it lacks; a poke the track lost; the first step whose hash
// differs.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, ask, bakeCall, caught, drop, entryText, extraRows, firstContact, firstDiffering, hashesOf, live, none, open, pokeAt,
  prebuild, recordCall, recordOf, rowText, rowsOf, type Frame, type Planted, type Recorded, type Row,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[5];
const SPAN = 4;
const END = 480;
const TOUCH = 250;
const SIDE = pokeAt(252, [2, 0, 0]);
const UP = pokeAt(240, [0, 25, 0]);
const RAN_TO = 256;
const RESTORED = 240;

interface Ran { before: Recorded; late: Frame; again: Frame[]; after: Recorded }
async function ran(planted?: Planted): Promise<Ran> {
  const l = live(planted);
  try {
    const { s } = await open(l, drop(), [SIDE], SPAN);
    const there = await s.land(await s.frame({ seek: RAN_TO }));
    expect(there?.at, `the world runs to step ${RAN_TO}`).toBe(RAN_TO);
    const before = recordOf(await l.call(recordCall(s.id)), `the record at step ${RAN_TO}, before the late poke`);
    const n = s.frames.length;
    const late = await s.frame({ late: UP });
    const back = await s.land(late);
    expect(back?.at, `the world steps to ${RAN_TO} again`).toBe(RAN_TO);
    const again = s.frames.slice(n);
    const end = await s.land(await s.frame({ seek: END }));
    expect(end?.at, `and runs on to step ${END}`).toBe(END);
    const after = recordOf(await l.call(recordCall(s.id)), `the record at step ${END}`);
    return { before, late, again, after };
  } finally { l.stop(); }
}
/** The session's world against the run with both pokes from the start; each failure names what differs first. */
function judge(after: Recorded, straight: { hashes: string[]; rows: Row[] }): string[] {
  const f: string[] = [];
  for (const want of [UP, SIDE]) {
    if (!after.track.some((e) => e['step'] === want['step'] && e['kind'] === 'poke')) f.push(`the track lost its ${entryText(want)}: it holds ${after.track.map(entryText).join(', ') || 'nothing'}`);
  }
  const kept = extraRows(after.rows, straight.rows);
  if (kept.length) f.push(`the occurrence list keeps ${rowText(kept[0]!)}, which the run with both pokes from the start doesn't make${kept.length > 1 ? ` (and ${kept.length - 1} more)` : ''}`);
  const lacks = extraRows(straight.rows, after.rows);
  if (lacks.length) f.push(`the occurrence list lacks ${rowText(lacks[0]!)}, which the run with both pokes makes${lacks.length > 1 ? ` (and ${lacks.length - 1} more)` : ''}`);
  const touch = firstContact(after.rows.filter((r) => r.step === TOUCH), 'ball', 'floor');
  if (touch) f.push(`a contact at step ${TOUCH}: ${rowText(touch)}`);
  const k = firstDiffering(straight.hashes.slice(RESTORED), after.hashes.slice(RESTORED));
  if (k !== null) f.push(`the step hashes differ from the run with both pokes first at step ${RESTORED + k}`);
  return f;
}
function straightBoth(): { hashes: string[]; rows: Row[] } {
  const [both] = ask([bakeCall(drop(), [UP, SIDE], END)]);
  return { hashes: hashesOf(both, 'the run with both pokes from the start'), rows: rowsOf(both, 'the run with both pokes from the start') };
}

describe(`${ID} a late upward poke restores the checkpoint at step 240 and steps forward again, as if it had come on time`, () => {
  it(`${ID} the ball first touches the floor at step ${TOUCH}; the late poke at step 240, added at step ${RAN_TO}, restores step 240 and steps to ${RAN_TO} again, giving the step hashes and occurrence lists of the run with both pokes from the start, with no contact at step ${TOUCH}`, async () => {
    const [side] = ask([bakeCall(drop(), [SIDE], END)]);
    const touch = firstContact(rowsOf(side, 'the drop with the sideways poke'), 'ball', 'floor');
    expect(touch?.step, `the dropped ball first touches the floor at step ${TOUCH}`).toBe(TOUCH);
    const straight = straightBoth();
    expect(firstContact(straight.rows.filter((r) => r.step === TOUCH), 'ball', 'floor'), `with both pokes from the start, no contact at step ${TOUCH}`).toBeNull();

    const r = await ran();
    expect(firstContact(r.before.rows, 'ball', 'floor')?.step, `before the late poke the session's world touched the floor at step ${TOUCH}`).toBe(TOUCH);
    expect(r.late.forkAt, 'a late entry is no fork').toBeNull();
    expect(r.late.dropped, 'and drops nothing').toEqual([]);
    expect(r.late.restored, `the world restores its checkpoint at step ${RESTORED}`).toBe(RESTORED);
    expect(r.again.reduce((n, f) => n + f.steps, 0), `and steps to ${RAN_TO} again: ${RAN_TO - RESTORED} steps`).toBe(RAN_TO - RESTORED);
    none(judge(r.after, straight), 'the session against the run with both pokes from the start');
    expect(r.after.hashes.slice(RESTORED), `the same step hashes from step ${RESTORED} on`).toEqual(straight.hashes.slice(RESTORED));
  }, TIMEOUT);

  it(`${ID} a planted restore that keeps the replaced steps' occurrences (restore_keeps_replaced_occurrences) fails, naming the contact at step ${TOUCH}`, async () => {
    const straight = straightBoth();
    const failures = judge((await ran('restore_keeps_replaced_occurrences')).after, straight);
    caught(failures, 'restore_keeps_replaced_occurrences');
    expect(failures.some((x) => /contact_begin a ball(#\d+)? b floor(#\d+)?/.test(x) && x.includes(`step ${TOUCH}`)), `a failure names the contact of ball and floor at step ${TOUCH}: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} a planted late entry that forks at the late poke and drops the poke at step 252 (late_entry_forks) fails, naming that step`, async () => {
    const straight = straightBoth();
    const failures = judge((await ran('late_entry_forks')).after, straight);
    caught(failures, 'late_entry_forks');
    expect(failures.some((x) => x.includes('step 252')), `a failure names step 252: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});

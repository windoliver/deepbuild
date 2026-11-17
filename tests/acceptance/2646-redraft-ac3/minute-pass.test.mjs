// #2646.11122565: "With 30 days of history and no live session, the minute pass reads under 1% of the rows it reads on
// the merge base, and the states it reports for the record's sessions equal the merge base's at each of 120 minutes on
// a test clock. A planted pass that skips a session whose promise falls due fails, naming the session"
//
// Each side's hub starts on a copy of one record with its test clock half an hour before the record's hour, and no
// hook reaches it. For each of 120 minutes the hub's clock is stepped onto the minute (`test.clock`) and the core
// thread's 60,000 ms timers are called (fixtures/preload.cjs): the minute pass. Its rows are the rows its statements
// gave back, counted at better-sqlite3; the states it reports are the record's `session.state` events, read through
// `events.read`. README: The surface, Fixtures, Assumptions, What the implementation must provide.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  BASE, REPO, blocked, cleanup, control, copyRecord, eventsAfter, logOf, makeHome, noBase, proof, readLog, seed, settle, shared, startHub, stopHub, tempDir,
} from './helpers.mjs';

const ID = '#2646.11122565';
const MINUTES = 120;
const MINUTE = 60_000;
/** The planted wrong program: a hub whose state pass leaves out each session whose promise fell due (README). */
const PLANT = 'state-pass-skips-due-promise';
/** How long before the record's hour a hub's clock starts, so its start is over before minute 1. */
const HEAD_START = 30 * MINUTE;

after(cleanup);

/** Whether a statement reads the schema alone (a pragma's table, sqlite_master), not rows of the record. */
function schemaOnly(sql) {
  const read = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)/gi)].map(([, table]) => table.toLowerCase());
  return read.length > 0 && read.every((table) => table.startsWith('pragma_') || table === 'sqlite_master' || table === 'sqlite_schema');
}

/**
 * One hub of `checkout` on a copy of the record, taken through `upTo` minutes: `series[m - 1]` is each session's
 * reported state after minute m's pass, `rows[m - 1]` the rows that pass read. Or { problem }.
 */
async function minutes(checkout, fixture, { plant, upTo }) {
  const home = makeHome();
  copyRecord(fixture.path, home.ledger);
  const hub = await startHub({ checkout, home, minutes: true, clock: fixture.at - HEAD_START, plant });
  if (hub.problem) return hub;
  try {
    const cli = await control(hub);
    const log = logOf(hub);
    // The promise falls due as the hub starts: its time passed while no hub ran.
    const deadline = Date.now() + 300_000;
    for (;;) {
      const { events } = await eventsAfter(cli, 0, ['promise.due']);
      if (events.some((event) => event.session === fixture.promised)) break;
      if (Date.now() > deadline) return { problem: `BLOCKED: five minutes after ${checkout}'s hub started, the record holds no promise.due of session ${fixture.promised}: its promise didn't fall due` };
      await new Promise((done) => setTimeout(done, 100));
    }
    /** rows.read answers behind the state pass under way. */
    const settled = () => cli.call('rows.read', {});
    await settled();
    for (let m = 1; m <= upTo; m += 1) {
      const target = fixture.at + m * MINUTE;
      const { now } = await cli.call('test.clock', { advance_ms: 0 });
      if (now > target) return { problem: `INCONCLUSIVE: ${checkout}'s hub clock passed minute ${m} before it could be stepped there (${now - target} ms past): the machine is too slow to hold a test clock on the minute` };
      await cli.call('test.clock', { advance_ms: target - now });
      await settled();
      appendFileSync(hub.minutesFile, `${m}\n`);
      const fired = await log.until((line) => line.t === 'fired' && line.minute === m, 300_000);
      if (!fired) return { problem: `BLOCKED: ${checkout}'s core thread did not take minute ${m} within five minutes` };
      if (!fired.timers) return { problem: `BLOCKED: ${checkout}'s core thread set no 60,000 ms interval timer, so its minute pass can't be brought on (README: What the implementation must provide)` };
      // Until two waits behind the pass under way, 250 ms apart (a pass comes 200 ms after it is asked for), find
      // nothing more read under the minute.
      const read = () => log.more().filter((line) => line.t === 'x' && line.minute === m).length;
      for (let before = -1, tries = 0; tries < 100; tries += 1) {
        await settled();
        const count = read();
        if (count === before) break;
        before = count;
        await new Promise((done) => setTimeout(done, 250));
      }
      const late = (await cli.call('test.clock', { advance_ms: 0 })).now - target;
      if (late >= MINUTE / 2) return { problem: `INCONCLUSIVE: minute ${m}'s pass of ${checkout}'s hub was still running ${late} ms into the minute, past the half minute the fixture's times keep clear: the machine is too slow to hold a test clock on the minute` };
    }
    // The states reported by each minute: a session.state carries the hub's clock, which stood inside its minute.
    const reported = (await eventsAfter(cli, 0, ['session.state'])).events.filter((event) => event.session);
    const series = [];
    const states = new Map();
    let at = 0;
    for (let m = 1; m <= upTo; m += 1) {
      for (; at < reported.length && reported[at].ts < fixture.at + (m + 1) * MINUTE; at += 1) states.set(reported[at].session, `${reported[at].data.state}/${reported[at].data.cause}`);
      series.push(new Map(states));
    }
    cli.close();
    const lines = log.more();
    const counted = readLog(lines, hub);
    if (counted.problem) return counted;
    const rows = Array.from({ length: upTo }, () => 0);
    const texts = new Set();
    for (const line of lines) {
      if (line.t !== 'x' || line.minute === undefined || line.thread !== counted.core) continue;
      const sql = counted.text.get(line.id) ?? '';
      if (schemaOnly(sql)) continue;
      rows[line.minute - 1] += line.rows;
      texts.add(line.id);
    }
    return { series, rows, total: rows.reduce((sum, n) => sum + n, 0), statements: texts.size };
  } finally {
    await stopHub(hub);
  }
}

/** The first minute and session at which two runs report different states, or null. */
function differs(own, base, upTo) {
  for (let m = 1; m <= upTo; m += 1) {
    const [mine, theirs] = [own.series[m - 1], base.series[m - 1]];
    for (const session of [...new Set([...theirs.keys(), ...mine.keys()])].sort()) {
      const [a, b] = [mine.get(session) ?? 'no state', theirs.get(session) ?? 'no state'];
      if (a !== b) return { minute: m, session, own: a, base: b };
    }
  }
  return null;
}
/** Each change of a session's reported state over a run: [session, minute, from, to]. */
function moves(run) {
  const out = [];
  for (let m = 2; m <= run.series.length; m += 1) {
    for (const [session, state] of run.series[m - 1]) {
      const was = run.series[m - 2].get(session) ?? 'no state';
      if (was !== state) out.push([session, m, was, state]);
    }
  }
  return out;
}

/**
 * The record, seeded once (by the merge base's own record package when there is a merge base), and each side's 120
 * minutes on a copy of it. With no merge base there is nothing to compare, and only the record is made.
 */
const scene = shared(async () => {
  const base = noBase() ? null : BASE;
  const at = Math.floor(Date.now() / MINUTE) * MINUTE;
  const fixture = seed(base ?? REPO, 'history', join(tempDir(), 'seed', 'ledger.db'), at);
  if (fixture.problem) return fixture;
  if (!base) return { fixture };
  const own = await minutes(REPO, fixture, { upTo: MINUTES });
  if (own.problem) return { problem: `${own.problem} (this checkout)` };
  proof('the minute pass on this checkout', { rows_over_120_minutes: own.total, rows_by_minute: own.rows.join(' '), statements: own.statements, sessions: own.series.at(-1).size, states_the_clock_moved: moves(own), promised: own.series[0].get(fixture.promised) ?? 'no state' });
  const theirs = await minutes(base, fixture, { upTo: MINUTES });
  if (theirs.problem) return { problem: `${theirs.problem} (the merge base)` };
  proof('the minute pass on the merge base', { rows_over_120_minutes: theirs.total, rows_by_minute: theirs.rows.join(' '), statements: theirs.statements, sessions: theirs.series.at(-1).size, states_the_clock_moved: moves(theirs), promised: theirs.series[0].get(fixture.promised) ?? 'no state' });
  return { fixture, own, base: theirs };
});

describe(`${ID} the minute pass with 30 days of history and no live session`, { timeout: 6 * 3_600_000 }, () => {
  it(`${ID} the minute pass reads under 1% of the rows it reads on the merge base, and the states it reports equal the merge base's at each of 120 minutes on a test clock`, async () => {
    settle(noBase());
    const s = await scene();
    settle(s.problem);
    // The instrument and the fixture, on the merge base: each of its minute passes reads every session, the clock
    // alone moves three sessions' states, and the session whose promise fell due reads so.
    const short = s.base.rows.findIndex((n) => n < s.fixture.sessions);
    if (short >= 0) blocked(`the merge base's minute ${short + 1} read ${s.base.rows[short]} rows under the 60,000 ms timers, fewer than the record's ${s.fixture.sessions} sessions: its minute pass wasn't the one counted`);
    const moved = new Set(moves(s.base).map(([session]) => session));
    if (moved.size < 3) blocked(`on the merge base the clock moved the state of ${moved.size} sessions in 120 minutes, and the fixture holds three it should: ${JSON.stringify(moves(s.base))}`);
    if (s.base.series[0].get(s.fixture.promised) !== 'flagged/promised') blocked(`the merge base reports ${s.base.series[0].get(s.fixture.promised) ?? 'no state'} for session ${s.fixture.promised}, whose promise fell due, not flagged/promised`);
    // And on this checkout: a minute whose pass moved a state read at least that session under the timers.
    const uncounted = moves(s.own).find(([, m]) => s.own.rows[m - 1] === 0);
    if (uncounted) blocked(`at minute ${uncounted[1]} this checkout reported session ${uncounted[0]} going from ${uncounted[2]} to ${uncounted[3]}, and no row was read under the core thread's 60,000 ms timers: its minute pass wasn't the one counted (README: What the implementation must provide)`);

    const share = s.own.total / s.base.total;
    assert.ok(s.own.total < 0.01 * s.base.total,
      `over ${MINUTES} minutes the minute pass read ${s.own.total} rows, ${(share * 100).toFixed(2)}% of the ${s.base.total} it reads on the merge base; under 1% is required (minute 120 alone: ${s.own.rows.at(-1)} rows against ${s.base.rows.at(-1)})`);
    const first = differs(s.own, s.base, MINUTES);
    assert.equal(first, null, first && `at minute ${first.minute} the state reported for session ${first.session} is ${first.own}, and the merge base's is ${first.base}`);
  });

  it(`${ID} a planted pass that skips a session whose promise falls due fails, naming the session`, async () => {
    const s = await scene();
    settle(s.problem);
    const planted = await minutes(REPO, s.fixture, { plant: PLANT, upTo: 3 });
    if (planted.problem) {
      assert.doesNotMatch(planted.problem, /names no planted program/, `this checkout's hub has no planted pass to fail: DEEP_HUB_PLANT=${PLANT} names no planted program (README: What the implementation must provide)`);
      settle(planted.problem);
    }
    settle(noBase());
    const first = differs(planted, s.base, 3);
    proof('the planted pass', first ?? 'reports the merge base\'s states for three minutes');
    assert.ok(first, `the planted pass, DEEP_HUB_PLANT=${PLANT}, was not caught: for three minutes its hub reports the merge base's state for every session, session ${s.fixture.promised} included, whose promise fell due`);
    assert.equal(first.session, s.fixture.promised, `the planted pass fails on session ${first.session} (${first.own}, the merge base's ${first.base}, at minute ${first.minute}), not on ${s.fixture.promised}, the session whose promise fell due`);
  });
});

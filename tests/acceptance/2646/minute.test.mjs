// #2646.11122565: with 30 days of history and no live session, the minute pass reads under 1% of the rows it reads on
// the merge base, and the states it reports equal the merge base's at each of 120 minutes on a test clock.
//   DEEP_2646_BASE=<built merge base> node --test tests/acceptance/2646/minute.test.mjs
// Each side's hub starts on the same seeded record (probe.mjs, seed-month) with its reads log on, its clock a test
// clock, and its one-minute interval fired by the test (minute-clock.mjs). At each minute the test steps the hub's clock
// to that minute, fires the interval, waits for the state pass to land (inbox.read answers behind it), and reads the
// newest session.state of every session from the record's file. The rows a pass read are the rows its logged raw
// reads returned, each replayed on the file read-only once the hub has stopped, less those of the next wait, which
// holds no pass. The merge base's minutes run first; the two sides are then compared minute by minute.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BASE, CHANGE, HERE, control, follow, probe, rawOf, remove, settled, sidesProblem, sleep, sqlite, startHub, stopHub, tempHome, until } from './lib.mjs';

const MINUTES = 120, MINUTE = 60_000;
// Minute 0 on the test clock; each hub starts five minutes before it.
const ZERO = 1_793_000_000_000;

/**
 * One side's 120 minutes: { seeded, states: [minute 1..120 → { session: 'state/cause' }], rows: [the rows each minute's
 * pass read] }. With `like`, the merge base's states, a minute whose states don't yet read as the merge base's is read
 * again for up to five seconds, so a pass that lands a moment after its interval ran is still that minute's.
 */
async function minutes(checkout, like) {
  const home = tempHome(), ledger = join(home, '.deepbuild', 'ledger.db'), reads = join(home, 'reads.jsonl'), tick = join(home, 'minutes');
  let hub, db;
  try {
    mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
    const seeded = await probe(checkout, 'seed-month', { ledger, clock: ZERO });
    writeFileSync(tick, '0');
    writeFileSync(`${tick}.ack`, '');
    hub = await startHub(checkout, home, { DEEP_HUB_TEST_READS: reads, DEEP_HUB_TEST_CLOCK: String(ZERO - 5 * MINUTE), DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_2646_MINUTES: tick }, ['--import', join(HERE, 'minute-clock.mjs')]);
    db = sqlite(ledger);
    const due = db.prepare("SELECT 1 FROM events WHERE kind = 'promise.due' AND session_id = ?");
    await until(() => due.get(seeded.promised), 300_000, `BLOCKED: the promise of session ${seeded.promised} did not fall due at the hub's start, so the fixture holds no session whose promise falls due`);
    await settled(hub);
    const newest = db.prepare("SELECT session_id, json_extract(data, '$.state') AS state, json_extract(data, '$.cause') AS cause FROM events WHERE kind = 'session.state' AND log_pos IN (SELECT max(log_pos) FROM events WHERE kind = 'session.state' AND session_id IS NOT NULL GROUP BY session_id)");
    const reported = () => Object.fromEntries(newest.all().map((row) => [row.session_id, `${row.state}/${row.cause}`]));
    // minute-clock.mjs's lines: `<thread>:reg` once a thread holds a one-minute job, `<thread>:<n>` once it ran minute n.
    const acks = () => readFileSync(`${tick}.ack`, 'utf8').split('\n').filter(Boolean).map((line) => line.split(':'));
    const more = follow(reads), log = [];
    const mark = () => { log.push(...more()); return log.length; };
    const states = [], segments = [];
    let late = 0;
    for (let minute = 0; minute <= MINUTES; minute++) {
      // The hub's clock runs on between steps, so each minute is stepped to, never by a fixed 60 s.
      const now = Number((await control(hub, (call) => call('test.clock', { advance_ms: 0 }))).now);
      const step = ZERO + minute * MINUTE - now;
      if (step < -20_000) throw Error(`INCONCLUSIVE: the hub's clock read ${-step} ms past minute ${minute} of the test clock before the test could step to it; the machine is too loaded to hold 120 one-minute steps apart`);
      await control(hub, (call) => call('test.clock', { advance_ms: Math.max(0, step) }));
      await settled(hub);
      if (minute === 0) continue;
      const from = mark();
      writeFileSync(tick, String(minute));
      await until(() => {
        const lines = acks();
        const threads = new Set(lines.filter(([, what]) => what === 'reg').map(([thread]) => thread));
        return threads.size > 0 && [...threads].every((thread) => lines.some(([t, n]) => t === thread && Number(n) >= minute));
      }, 120_000, () => `BLOCKED: no thread of the hub ran its one-minute interval for minute ${minute} (minute-clock.mjs); the acknowledgements read ${JSON.stringify(acks())}`);
      await settled(hub);
      let read = reported();
      const same = () => JSON.stringify(Object.entries(read).sort()) === JSON.stringify(Object.entries(like[minute - 1]).sort());
      if (like && late < 3 && !same()) {
        for (const end = Date.now() + 5000; !same() && Date.now() < end; read = reported()) { await sleep(50); await settled(hub); }
        if (!same()) late++;
      }
      const middle = mark();
      await settled(hub);
      segments.push({ pass: [from, middle], idle: [middle, mark()] });
      states.push(read);
    }
    await stopHub(hub);
    hub = undefined;
    mark();
    // The rows each raw read returned, counted once per distinct read on the record as the 120 minutes left it. The
    // asks core's cursor reads are #2646.9ca53003's to count, and are left out here.
    const counted = new Map();
    const rowsOf = (entry) => {
      if (entry.via !== 'raw' && entry.via !== 'table') return 0;
      const key = `${entry.via} ${entry.query}`;
      if (!counted.has(key)) {
        if (entry.via === 'raw') {
          const { sql, params } = rawOf(entry);
          counted.set(key, db.prepare(sql).all(...params).length);
        } else counted.set(key, db.prepare(`SELECT count(*) AS n FROM "${String(JSON.parse(entry.query)[0]).replace(/"/g, '')}"`).get().n);
      }
      return counted.get(key);
    };
    const sum = ([from, to]) => log.slice(from, to).reduce((total, entry) => total + rowsOf(entry), 0);
    // A read this test can't count (a session's view, a slice) is no row count: more of them in a pass than in the wait after it is INCONCLUSIVE.
    const uncounted = ([from, to]) => log.slice(from, to).filter((entry) => !['raw', 'table', 'read'].includes(entry.via));
    for (const { pass, idle } of segments) {
      if (uncounted(pass).length > uncounted(idle).length) throw Error(`INCONCLUSIVE: a minute's pass made a ${uncounted(pass)[0].via} read (${String(uncounted(pass)[0].query).slice(0, 200)}), whose rows this test can't count`);
    }
    return { seeded, states, rows: segments.map(({ pass, idle }) => Math.max(0, sum(pass) - sum(idle))) };
  } finally {
    db?.close();
    if (hub) await stopHub(hub);
    remove(home);
  }
}

describe('#2646 the minute pass', { timeout: 3_600_000 }, () => {
  it('#2646.11122565 with 30 days of history and no live session, the minute pass reads under 1% of the rows it reads on the merge base, and reports the merge base\'s states at each of 120 minutes on a test clock', async () => {
    const blocked = sidesProblem();
    if (blocked) assert.fail(blocked);
    const base = await minutes(BASE);
    const change = await minutes(CHANGE, base.states);
    const { crossing, promised } = base.seeded;
    assert.deepEqual(change.seeded, base.seeded, 'BLOCKED: the two sides seeded different records');

    // The fixture, as the merge base reads it: a promise that fell due, and one state that changed with time alone.
    const at = (side, minute, session) => side.states[minute - 1][session];
    if (at(base, 1, promised) !== 'flagged/promised' || at(base, 30, crossing) !== 'finished/finished' || at(base, 31, crossing) !== 'quiet/quiet') {
      assert.fail(`BLOCKED: the merge base doesn't read the fixture as it was seeded, so its minute pass can't be compared: the session whose promise fell due (${promised}) reads ${at(base, 1, promised)} at minute 1, not flagged/promised, and the session a day old at minute 30.5 (${crossing}) reads ${at(base, 30, crossing)} at minute 30 and ${at(base, 31, crossing)} at minute 31, not finished/finished then quiet/quiet`);
    }
    const baseRows = base.rows.reduce((a, b) => a + b, 0), changeRows = change.rows.reduce((a, b) => a + b, 0);
    if (!(baseRows > 0)) assert.fail(`INCONCLUSIVE: the merge base's ${MINUTES} minute passes read no rows the reads log shows, so there is nothing to take 1% of`);

    // The states, minute by minute; a difference names its session.
    const differences = [];
    for (let minute = 1; minute <= MINUTES; minute++) {
      for (const session of new Set([...Object.keys(base.states[minute - 1]), ...Object.keys(change.states[minute - 1])])) {
        if (at(base, minute, session) !== at(change, minute, session)) differences.push(`at minute ${minute} session ${session}${session === promised ? ', whose promise fell due,' : session === crossing ? ', a day old at minute 30.5,' : ''} is reported ${at(change, minute, session) ?? 'in no state'}, and ${at(base, minute, session) ?? 'in no state'} on the merge base`);
      }
    }
    assert.equal(differences.length, 0, `the states the hub reports differ from the merge base's ${differences.length} times over ${MINUTES} minutes:\n${differences.slice(0, 12).join('\n')}`);

    const share = changeRows / baseRows;
    assert.ok(share < 0.01, `the minute pass read ${changeRows} rows over ${MINUTES} minutes and ${baseRows} on the merge base: ${(share * 100).toFixed(2)}%, not under 1% (rows a minute, first five: ${change.rows.slice(0, 5).join(', ')} against ${base.rows.slice(0, 5).join(', ')})`);
  });
});

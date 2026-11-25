// #3389.145cd5e7: 80 sessions start, stop and end through their hooks, so the hub lets go of the 16 that ended first (it
// keeps the newest 64); the test clock steps a day past their last event, and the minute pass records each as quiet,
// though nothing was appended. The minute pass runs on the wall clock, so the test waits for it, at most a minute.
//   node --test tests/acceptance/3389/quiet.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHANGE, control, hook, ledgerOf, listed, quiet, remove, sessionId, settled, sqlite, startHub, stopHub, tempHome, unbuilt, until } from './lib.mjs';

const SESSIONS = Array.from({ length: 80 }, (_, n) => sessionId(n));
const KEPT = 64, DAY = 86_400_000;

describe('#3389 a session the hub let go of', { timeout: 1_800_000 }, () => {
  it('#3389.145cd5e7 with 80 sessions ended and the test clock stepped a day past their last event, no append in between, the minute pass records each as quiet', async () => {
    const blocked = unbuilt(CHANGE);
    if (blocked) assert.fail(blocked);
    const home = tempHome();
    let hub, db;
    try {
      hub = await startHub(CHANGE, home, { DEEP_HUB_TEST_CLOCK_STEPS: '1' });
      db = sqlite(ledgerOf(home));
      for (const [n, session] of SESSIONS.entries()) {
        await hook(hub, session, 'SessionStart', { source: 'startup' });
        await hook(hub, session, 'UserPromptSubmit', { prompt: `say what value ${n} is` });
        await hook(hub, session, 'Stop', { stop_hook_active: false, last_assistant_message: `The value is ${n}.` });
        await hook(hub, session, 'SessionEnd', { reason: 'other' });
        // Each session's finished state is recorded, and the time it ends known, well before the hub lets go of it.
        if (n % 8 === 7) await settled(hub);
      }
      const ended = db.prepare("SELECT count(DISTINCT session_id) AS n FROM events WHERE kind = 'session.end'");
      await until(() => ended.get().n === SESSIONS.length, 120_000, () => `BLOCKED: ${ended.get().n} of ${SESSIONS.length} sessions' ends are recorded`);
      await quiet(db, hub);
      const before = listed(db).states;
      assert.deepEqual(SESSIONS.filter((id) => before[id] !== 'finished/finished'), [], `BLOCKED: every session reads finished before the clock steps: ${JSON.stringify(before[SESSIONS[0]])}`);
      const last = db.prepare("SELECT max(ts) AS ts, max(log_pos) AS pos FROM events WHERE kind = 'session.end'").get();
      const { now } = await control(hub, (call) => call('test.clock', { advance_ms: 0 }));
      await control(hub, (call) => call('test.clock', { advance_ms: Math.max(0, last.ts + DAY + 60_000 - Number(now)) }));

      const left = () => { const { states } = listed(db); return SESSIONS.filter((id) => states[id] !== 'quiet/quiet'); };
      // Two of its minutes, and a minute more for a loaded machine.
      await until(() => !left().length, 180_000, 'left').catch((error) => { if (error.message !== 'left') throw error; });
      await settled(hub);
      const { states } = listed(db);
      const appended = db.prepare("SELECT DISTINCT kind FROM events WHERE log_pos > ? AND kind NOT IN ('session.state', 'row.set')").all(last.pos).map((r) => r.kind).join(', ');
      const named = left().map((id) => { const n = SESSIONS.indexOf(id); return `session ${id}, number ${n + 1} of 80 to end${n < SESSIONS.length - KEPT ? ', which the hub let go of,' : ','} was left ${states[id]}`; });
      assert.equal(named.length, 0, `with the clock a day past their last event, the minute pass left ${named.length} of 80 sessions unrecorded as quiet: ${named.slice(0, 3).join('; ')}${named.length > 3 ? '; and more' : ''} (appended since they ended, states and rows aside: ${appended || 'nothing'})`);
    } finally {
      db?.close();
      if (hub) await stopHub(hub);
      remove(home);
    }
  });
});

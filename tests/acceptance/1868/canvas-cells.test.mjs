// #1868.f34f3f9c: with 200,000 `reading.recorded` events and 5,000 asks in the record, a `canvas.user` `cells` call
// answers within 20% of its time with an empty record, on the reference Mac. The merge base fails this, naming both
// times.
//   node --test tests/acceptance/1868/canvas-cells.test.mjs
// Two hubs of this checkout, each on a home of its own: one starts on no record, one on a record of 30 days holding
// 200,000 readings and 5,000 asks (probe.mjs, seed-canvas). In each, one session starts through its hooks, and the test
// connects as the app does (the `app` hello with the control token) and sends the call the app's open Terminal tab
// sends every 250 ms: canvas.user { call: { call: "cells", session, tab: "terminal" } }. Both hubs must give the same
// reply before any time counts. A call's time runs from its line written to its reply read, on one connection.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Agent, as, judgeWithin, makeWorktree, probe, remove, resultOf, startHub, stopHub, tempHome, timeSides, unbuilt } from './lib.mjs';

const SESSION = '18680001-0000-4000-8000-000000001868';
const READINGS = 200_000, ASKS = 5000;
/** A run is the median of this many consecutive calls. */
const CALLS = 3;
const CELLS = { call: { call: 'cells', session: SESSION, tab: 'terminal' } };

/** A hub on an empty record, or on the seeded one, with the session live. */
async function side(seed, opened) {
  const home = tempHome();
  const own = { home };
  opened.push(own);
  const worktree = makeWorktree(home);
  if (seed) {
    const seeded = await probe('seed-canvas', { ledger: join(home, '.deepbuild', 'ledger.db'), now: Date.now(), readings: READINGS, asks: ASKS });
    if (seeded.readings !== READINGS || seeded.asks !== ASKS) throw Error(`BLOCKED: the record was not seeded as asked: ${JSON.stringify(seeded)}, for ${READINGS} readings and ${ASKS} asks`);
  }
  const hub = await startHub(home);
  own.hub = hub;
  const agent = new Agent(hub, worktree, SESSION);
  own.agent = agent;
  await agent.begin();
  return hub;
}

describe('#1868 a canvas call on a long record', { timeout: 3_600_000 }, () => {
  it('#1868.f34f3f9c with 200,000 reading.recorded events and 5,000 asks in the record, a canvas.user cells call answers within 20% of its time with an empty record', async () => {
    const blocked = unbuilt({ canvas: true });
    if (blocked) throw Error(blocked);
    const opened = [];
    try {
      const [empty, seeded] = await Promise.all([side(false, opened), side(true, opened)]);
      const verdict = await as(empty, 'app', (onEmpty) => as(seeded, 'app', async (onSeeded) => {
        // The same call gets the same reply on both records: nothing in it comes from an ask or a reading.
        const first = resultOf(await onEmpty('canvas.user', CELLS), 'canvas.user cells on the empty record');
        const second = resultOf(await onSeeded('canvas.user', CELLS), 'canvas.user cells on the seeded record');
        assert.deepEqual(second, first, 'the cells call answers differently on the seeded record than on the empty one');
        const call = (on) => async () => { const reply = await on('canvas.user', CELLS); resultOf(reply, 'canvas.user cells'); return reply.ms; };
        const times = await timeSides(call(onEmpty), call(onSeeded), CALLS);
        return judgeWithin(times, 'a canvas.user cells call', `with ${READINGS.toLocaleString('en-US')} reading.recorded events and ${ASKS.toLocaleString('en-US')} asks in the record`, 'with an empty record');
      }));
      assert.equal(verdict.status, 'PASS', verdict.message);
    } finally {
      for (const { agent, hub, home } of opened.reverse()) {
        await agent?.stop();
        if (hub) await stopHub(hub);
        remove(home);
      }
    }
  });
});

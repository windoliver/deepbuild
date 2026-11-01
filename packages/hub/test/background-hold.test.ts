// The hub's gate runner holds a green stop's slow checks while the session's background work runs (#907): until the
// work ends, and at most 30 minutes from the stop, when the session's row learns what still runs; a newer stop that
// takes the place gets 30 minutes of its own. The real gate runner on the real record and real git repositories; the
// host's run start is the boundary, recorded here. Timers are faked; the record and git run for real.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { GateRunner } from '../src/gate-runner.js';
import { makeRepo, session, ulid } from '../../../tests/acceptance/29/helpers.ts';
import { cleanRuns, CORE, E2E, J, MINUTE, tempDir907 } from '../../../tests/acceptance/907/helpers.ts';

/** Lets the gate runner's queue, the record's reads and the starts it makes settle; timers stay faked. */
const settle = async () => { for (let i = 0; i < 200; i++) await new Promise((done) => setImmediate(done)); };

interface Started { claim: string; check: string; lane: string }
async function world(): Promise<{ record: RecordStore; gate: GateRunner; started: Started[]; capped: [string, string[]][] }> {
  const record = await openRecord({ path: join(tempDir907(), 'ledger.db'), now: Date.now });
  await cleanRuns(record, J, 300_000);
  const started: Started[] = [];
  const capped: [string, string[]][] = [];
  const gate = new GateRunner({
    raw: (query, params) => record.raw(query, params), now: Date.now, append: (connection, input) => record.append(connection, input), core: CORE,
    start: async (r) => { started.push({ claim: r.claim, check: r.check, lane: r.lane }); return `run:${ulid()}`; },
    // The journey runs on past the test: no run ends.
    ended: () => new Promise<string>(() => undefined),
    slots: () => ({ free: 2 }), budget_ms: 10_000, hold_ms: 60_000,
    capped: (s, checks) => { capped.push([s, checks]); },
  });
  return { record, gate, started, capped };
}
/** A green stop on a fresh snapshot whose only check is the 300 s journey, which the budget leaves to the slow lane. */
async function stop(gate: GateRunner, s: string, n: number): Promise<string> {
  const claim = `claim:${ulid()}`;
  const { dir } = makeRepo({ 'src/cart.ts': `export const total = ${n};\n` });
  const ran = await gate.stop({ session: s, claim, cwd: dir, checks: [{ check: J, approved: 'journey', on_base: 'passes' }], stopAt: Date.now() });
  expect(ran.slow, 'the 300 s journey is a slow-lane check').toEqual([J]);
  return claim;
}
const journeys = (started: Started[], claim: string) => started.filter((x) => x.check === J && x.claim === claim);

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('#907 background work holds a stop\'s slow checks in the hub, at most 30 minutes', () => {
  it('the journey waits while `npm run e2e` runs in the background, and starts once it ends', async () => {
    const { record, gate, started } = await world();
    try {
      const s = session();
      const claim = await stop(gate, s, 1);
      gate.turnEnded(claim, [E2E], Date.now());
      await settle();
      expect(journeys(started, claim), `${E2E} still runs in the background, so the journey waits in its place`).toEqual([]);
      gate.backgroundEnded(s);
      await settle();
      expect(journeys(started, claim).map((x) => x.lane), 'once it ends, the journey starts in the slow lane').toEqual(['slow']);
    } finally { await record.close(); }
  }, 60_000);

  it('background work that never ends holds the journey 30 minutes from the stop; then it starts and the row learns what still runs', async () => {
    const { record, gate, started, capped } = await world();
    try {
      const s = session();
      const claim = await stop(gate, s, 1);
      gate.turnEnded(claim, [E2E], Date.now());
      await vi.advanceTimersByTimeAsync(30 * MINUTE - 1000);
      await settle();
      expect(journeys(started, claim), 'nothing starts before 30 minutes from the stop').toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      await settle();
      expect(journeys(started, claim).map((x) => x.lane), 'the journey is pending past 30 minutes from the stop: it must start then').toEqual(['slow']);
      expect(capped, 'the session\'s row is told which checks waited 30 minutes, to name what still runs').toEqual([[s, [J]]]);
    } finally { await record.close(); }
  }, 60_000);

  it('a stop 20 minutes later, with the command run again in the background, takes the place and gets 30 minutes of its own', async () => {
    const { record, gate, started } = await world();
    try {
      const s = session();
      const first = await stop(gate, s, 1);
      gate.turnEnded(first, [E2E], Date.now());
      await vi.advanceTimersByTimeAsync(20 * MINUTE);
      const second = await stop(gate, s, 2);
      gate.turnEnded(second, [E2E], Date.now());
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      await settle();
      expect(started.filter((x) => x.check === J), '30 minutes from the first stop, nothing starts: the second stop has its own 30 minutes').toEqual([]);
      await vi.advanceTimersByTimeAsync(20 * MINUTE);
      await settle();
      expect(journeys(started, second).map((x) => x.lane), 'the journey starts on the second snapshot 30 minutes from its stop').toEqual(['slow']);
      expect(journeys(started, first), 'the first snapshot\'s journey never starts: the newer stop took its place').toEqual([]);
    } finally { await record.close(); }
  }, 60_000);
});

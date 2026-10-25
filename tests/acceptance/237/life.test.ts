// #237 AC5, AC6 and AC10: a lease's life on a clock the test sets. Past its expiry a lease is only stale; it ends
// when its holder has ended and every process recorded for it is proven gone, and its release cites that proof;
// a key whose lease ended waits out its kind's cooldown; a kind's cap BLOCKs a run past it; and a holder whose
// agent was killed with SIGKILL reads ended by its PID and start time. The processes are real: the supervisor's
// (#236) for a run's, and a sleeper this test starts for an agent's.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from '../../../packages/record/src/index.ts';
import type { Lease, LeaseKind, Plant } from '../../../packages/leases/src/index.ts';
import { at, cleanup, dataOf, json, killHard, makeClock, MINUTE, runId, session, startSleeper, startOf } from './helpers.ts';
import { as, granted, openWorld, refusedNaming, type World } from './world.ts';

afterEach(cleanup);

const SCREEN: LeaseKind = { name: 'test.screen', match: 'exact', cap: 4, cooldown: 0, cost: 0 };
const screen = (key = 'screen-1') => ({ host: 'local', kind: 'test.screen', key });

/** The record's lease.released events for a lease. */
async function releasesOf(w: World, lease: Lease): Promise<Event[]> {
  return (await w.events('lease.released')).filter((e) => {
    const d = e.data as { resource?: { host?: string; kind?: string; key?: string }; holder?: string };
    return d.resource?.host === lease.resource.host && d.resource?.kind === lease.resource.kind && d.resource?.key === lease.resource.key && d.holder === lease.holder;
  });
}
const proofOf = (e: Event): string[] => {
  const proof = dataOf(e).proof;
  expect(Array.isArray(proof) && proof.every((p) => typeof p === 'string'), `the release event's data.proof lists event IDs: ${json(e.data)}`).toBe(true);
  return proof as string[];
};
const viewOf = async (w: World, lease: Lease) => (await w.table.leases()).find((v) => v.lease.id === lease.id);

async function staleThenEndOnProof(plant?: Plant): Promise<void> {
  const w = await openWorld({ supervisor: true, ...(plant ? { plant } : {}) });
  try {
    await w.table.declare('test-screens', SCREEN);
    const [A, B] = [session(), session()];
    // A's run: one real process, started and recorded by the supervisor.
    const run = runId();
    const cwd = join(w.dir, 'run');
    mkdirSync(cwd);
    const started = await w.sup!.start({ run, cwd, argv: ['/bin/sleep', '600'] });
    if (started.status !== 'started') throw Error(`BLOCKED: the supervisor didn't start A's run: ${json(started)}`);
    const pid = started.pid;
    const a = granted(await w.table.lease({ holder: A, run }, screen(), 'exclusive'), 'A\'s lease on screen-1 for its run');
    expect(a.expires, 'the lease has an expiry after now').toBeGreaterThan(w.clock.now());
    expect((await viewOf(w, a))?.state, 'before its expiry the lease is held').toBe('held');

    // 20 minutes past its expiry, with A's session still running.
    w.clock.set(a.expires + 20 * MINUTE);
    await w.table.tick();
    let view = await viewOf(w, a);
    expect(view, 'a lease 20 minutes past its expiry stays with its holder while the holder session runs').toBeDefined();
    expect(view!.lease.holder).toBe(A);
    expect(view!.state, 'past its expiry the lease reads stale').toBe('stale');
    expect(view!.reading, 'stale is shown as a reading').toMatch(/\S/);
    const stale = (await w.events('lease.stale')).filter((e) => json(e.data).includes('"screen-1"'));
    expect(stale.length, 'the stale state comes from an event that says so (lease.stale)').toBeGreaterThanOrEqual(1);
    refusedNaming(await w.table.lease(as(B), screen(), 'exclusive'), a, 'B\'s lease on A\'s stale lease');
    expect(await releasesOf(w, a), 'nothing released at the expiry').toEqual([]);

    // A's session ends while its run's process still runs: the lease stays, and the stale reading names the process.
    const end = await w.endSession(A);
    await w.table.tick();
    view = await viewOf(w, a);
    expect(view, 'a holder that has ended while one of its processes still runs keeps the lease').toBeDefined();
    expect(view!.state).toBe('stale');
    expect(view!.reading ?? '', `the stale reading names the process still running, pid ${pid}`).toMatch(new RegExp(`\\b${pid}\\b`));
    refusedNaming(await w.table.lease(as(B), screen(), 'exclusive'), a, 'B\'s lease while A\'s process still runs');
    expect(await releasesOf(w, a), 'nothing released while a process recorded for the lease runs').toEqual([]);

    // The supervisor stops the run and proves its process gone; only then does the lease end, citing that proof.
    await w.sup!.cleanup(run);
    const gone = (await w.events('process.ended')).filter((e) => dataOf(e).run === run && dataOf(e).pid === pid);
    if (gone.length !== 1) throw Error(`BLOCKED: the supervisor recorded ${gone.length} process.ended for pid ${pid} of ${run}`);
    await w.table.tick();
    const released = await releasesOf(w, a);
    expect(released.length, 'the lease is released once its holder has ended and its processes are proven gone').toBe(1);
    const proof = proofOf(released[0]!);
    expect(proof, 'the release event cites the holder\'s end').toContain(end);
    expect(proof, 'the release event cites the supervisor\'s proof that the process is gone').toContain(gone[0]!.id);
    for (const s of stale) expect(proof, 'the release event never cites the expiry').not.toContain(s.id);
    expect(released[0]!.log_pos, 'released after the proof was recorded').toBeGreaterThan(gone[0]!.log_pos);
    expect(await viewOf(w, a), 'the table no longer shows the lease').toBeUndefined();
    granted(await w.table.lease(as(B), screen(), 'exclusive'), 'B\'s lease once A\'s has ended on proof');
  } finally {
    await w.close();
  }
}

describe('AC5 #237.635d92b7 stale as a reading; end on proof', () => {
  it('AC5 a lease 20 minutes past its expiry stays with its running holder and reads stale; a holder that ended with a process still running keeps it, the reading naming the process; it is released once the process is proven gone, citing that proof, never the expiry', async () => {
    await staleThenEndOnProof();
  }, 60_000);
  it('AC5 (wrong program) a table that releases a lease at its expiry fails this test', async () => {
    await expect(staleThenEndOnProof('releases-at-expiry')).rejects.toThrow(/a lease 20 minutes past its expiry stays with its holder|nothing released at the expiry|B's lease on A's stale lease/);
  }, 60_000);
});

async function cooldown(plant?: Plant): Promise<void> {
  const clock = makeClock(at(11, 50));
  const w = await openWorld({ clock, ...(plant ? { plant } : {}) });
  try {
    await w.table.declare('test-cool', { name: 'test.cool', match: 'exact', cap: 10, cooldown: 10 * MINUTE, cost: 0 });
    const key = (k: string) => ({ host: 'local', kind: 'test.cool', key: k });
    const [A, B] = [session(), session()];
    const a = granted(await w.table.lease(as(A), key('k'), 'exclusive'), 'A\'s lease on k at 11:50');
    // A ends at 12:00, with no process to prove gone: the lease ends at 12:00.
    clock.set(at(12, 0));
    await w.endSession(A);
    await w.table.tick();
    const released = await releasesOf(w, a);
    expect(released.map((e) => e.ts), 'A\'s lease ended at 12:00').toEqual([at(12, 0)]);
    clock.set(at(12, 5));
    const early = await w.table.lease(as(B), key('k'), 'exclusive');
    expect(early.status, `at 12:05 the key is refused: ${json(early)}`).toBe('refused');
    if (early.status !== 'refused') throw Error('unreachable');
    expect(early.reason).toBe('cooldown');
    expect(early.message, 'the refusal names the cooldown').toMatch(/cooldown/i);
    granted(await w.table.lease(as(B), key('k2'), 'exclusive'), 'another key of the kind at 12:05');
    clock.set(at(12, 11));
    granted(await w.table.lease(as(B), key('k'), 'exclusive'), 'k at 12:11, past the cooldown');
  } finally {
    await w.close();
  }
}

async function cap(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.table.declare('test-capped', { name: 'test.capped', match: 'exact', cap: 2, cooldown: 0, cost: 0 });
    const key = (k: string) => ({ host: 'local', kind: 'test.capped', key: k });
    granted(await w.table.lease({ holder: session(), run: runId() }, key('k1'), 'exclusive'), 'the first run\'s lease');
    granted(await w.table.lease({ holder: session(), run: runId() }, key('k2'), 'exclusive'), 'the second run\'s lease');
    const third = await w.table.lease({ holder: session(), run: runId() }, key('k3'), 'exclusive');
    expect(third.status, `a third run past the kind's cap of two is BLOCKED: ${json(third)}`).toBe('BLOCKED');
    if (third.status !== 'BLOCKED') throw Error('unreachable');
    expect(third.reason).toBe('cap');
    expect(third.message, 'the BLOCKED names the cap').toMatch(/\bcap\b/i);
    expect(third.message, 'the BLOCKED names the cap of two').toMatch(/\b2\b|\btwo\b/i);
  } finally {
    await w.close();
  }
}

describe('AC6 #237.9e8099b5 cooldowns and caps per kind', () => {
  it('AC6 on a kind with a 10-minute cooldown, a key whose lease ended at 12:00 is refused at 12:05, naming the cooldown, and granted at 12:11', async () => {
    await cooldown();
  });
  it('AC6 on a kind with a cap of two, a third run is BLOCKED, naming the cap', async () => {
    await cap();
  });
  it('AC6 (wrong program) a table that ignores the cooldown fails this test', async () => {
    await expect(cooldown('ignores-cooldown')).rejects.toThrow(/at 12:05 the key is refused/);
  });
  it('AC6 (wrong program) a table that ignores the cap fails this test', async () => {
    await expect(cap('ignores-cap')).rejects.toThrow(/a third run past the kind's cap of two is BLOCKED/);
  });
});

/** The released lease's proof cites a core event that names the agent's PID: the proof that it is gone. */
async function expectCitesGone(w: World, release: Event, pid: number, what: string): Promise<void> {
  const cited = new Set(proofOf(release));
  const naming = (await w.events()).filter((e) => cited.has(e.id) && e.writer === 'core' && new RegExp(`\\b${pid}\\b`).test(json(e.data)));
  expect(naming.length, `${what}: the release cites the core's record that pid ${pid} is gone; it cites ${json([...cited])}`).toBeGreaterThanOrEqual(1);
  for (const e of naming) expect(e.log_pos, 'the proof was recorded before the release').toBeLessThan(release.log_pos);
}

async function killedAgent(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.table.declare('test-screens', SCREEN);
    const agent = await startSleeper();
    const A = session();
    const a = granted(await w.table.lease({ holder: A, agent: { pid: agent.pid, start: agent.start } }, screen(), 'exclusive'), 'A\'s lease, its agent running');
    await w.table.tick();
    expect(await viewOf(w, a), 'while its agent runs, A keeps its lease').toBeDefined();
    await killHard(agent);
    await w.table.tick();
    expect(await viewOf(w, a), 'a holder whose agent was killed with SIGKILL reads ended once its PID and start time show it gone, and its lease is released').toBeUndefined();
    expect(await w.events('session.end'), 'no SessionEnd fired').toEqual([]);
    const released = await releasesOf(w, a);
    expect(released.length, 'one lease.released for A\'s lease').toBe(1);
    await expectCitesGone(w, released[0]!, agent.pid, 'killed with SIGKILL');
    granted(await w.table.lease(as(session()), screen(), 'exclusive'), 'the next holder\'s lease on screen-1');
  } finally {
    await w.close();
  }
}

async function reusedPid(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.table.declare('test-screens', SCREEN);
    // A live process holds the PID now, but it started at another time than the agent the table was told of.
    const other = await startSleeper();
    const recorded = 'Thu Jan  1 00:00:00 2026';
    if (startOf(other.pid) === recorded) throw Error('BLOCKED: the stand-in start time is the live process\'s own');
    const A = session();
    const result = await w.table.lease({ holder: A, agent: { pid: other.pid, start: recorded } }, screen(), 'exclusive');
    await w.table.tick();
    const kept = (await w.table.leases()).filter((v) => v.lease.holder === A);
    expect(kept, `the same PID reused with another start time keeps nothing: ${json(kept)}`).toEqual([]);
    if (result.status === 'granted') {
      const released = await releasesOf(w, result.lease);
      expect(released.length, 'a granted lease is released').toBe(1);
      await expectCitesGone(w, released[0]!, other.pid, 'a reused PID');
    }
    granted(await w.table.lease(as(session()), screen(), 'exclusive'), 'the next holder\'s lease on screen-1');
  } finally {
    await w.close();
  }
}

describe('AC10 #237.e6aa8a25 a holder killed with SIGKILL reads ended by its PID and start time', () => {
  it('AC10 a holder whose agent process is killed with SIGKILL, so no SessionEnd fires, reads ended once its PID and start time show it gone, and its lease is released citing that', async () => {
    await killedAgent();
  }, 30_000);
  it('AC10 the same PID reused with another start time keeps nothing', async () => {
    await reusedPid();
  }, 30_000);
  it('AC10 (wrong program) a table that reads a holder live while its PID runs, whatever its start time, fails this test', async () => {
    await expect(reusedPid('pid-only-liveness')).rejects.toThrow(/the same PID reused with another start time keeps nothing/);
  }, 30_000);
});

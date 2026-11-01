// #907 AC1: one check slot a held stop's quick checks can always take. With check slots at 2 (the real lease table at 4
// cores), two slow journeys started from two sessions' green stops and an agent's e2e waiting for a `cpu.slot` lease,
// a stop whose typecheck takes 3 s admits it to the hub's fast lane and it starts within 1 s of the stop. The hub's real
// gate runner, the real record, the real lease table, `@deepbuild/gate`'s `slot` and `runHeavy`, real git repositories
// and real processes. Then the same through the hub itself (`deep hub run`): its slow-lane runs never take the last
// slot of its pool, and its fast-lane run starts at once beside them.
import { availableParallelism } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runHeavy, verdictMemory } from '../../../packages/gate/src/index.ts';
import { makeRepo, mustFail, NODE, session, sleep, ulid } from '../29/helpers.ts';
import { allEvents, cleanup, CLI, Conn, makeHome, startHub, tempDir, type Ev, type Hub } from '../18/mapping/helpers.ts';
import { AC1, cleanRuns, gateOn, HEAVY, J, slotWorld, tempDir907, until } from './helpers.ts';

afterAll(cleanup, 60_000);

const claimId = (): string => `claim:${ulid()}`;
const TYPECHECK = 'typecheck';

// ---- The criterion's scenario on the gate runner and the lease table.
async function stopBesideBackgroundWork(plant?: string): Promise<void> {
  const w = await slotWorld(plant);
  // The record's clean runs: the typecheck takes 3 s, the journey 300 s.
  await cleanRuns(w.record, TYPECHECK, 3000);
  await cleanRuns(w.record, J, 300_000);
  const g = gateOn(w, { [TYPECHECK]: 3000, [J]: 0 });
  const slowHolders = new Set<string>();
  const marker = join(tempDir907(), 'e2e-started');
  let e2e: Promise<unknown> | undefined;
  let sampler: NodeJS.Timeout | undefined;
  try {
    // Two slow journeys: two sessions' green stops whose replies end the turn.
    for (const n of [1, 2]) {
      const s = session();
      const claim = claimId();
      slowHolders.add(s);
      g.holders.set(claim, s);
      const { dir } = makeRepo({ 'src/cart.ts': `export const total = ${n};\n` });
      const ran = await g.gate.stop({ session: s, claim, cwd: dir, checks: [{ check: J, approved: 'journey', on_base: 'passes' }], stopAt: Date.now() });
      expect(ran.slow, `scenario: the 300 s journey of session ${n} is a slow-lane check`).toEqual([J]);
      g.gate.turnEnded(claim);
    }
    expect(await until(() => g.started().some((x) => x.check === J), 15_000), 'scenario: a slow journey runs').toBe(true);
    await sleep(500);
    // The agent's e2e, a heavy command, waits for a cpu.slot lease.
    const agent = session();
    slowHolders.add(agent);
    const { dir: work } = makeRepo({ 'src/cart.ts': 'export const total = 0;\n' });
    e2e = runHeavy({ repo: work, session: agent, table: w.table, argv: [NODE, '-e', HEAVY, marker, g.go], inputs: ['src/**'], memory: verdictMemory() }).catch(() => undefined);
    await sleep(400);
    expect(existsSync(marker), 'scenario: the agent\'s e2e is waiting for a cpu.slot lease, not running').toBe(false);

    // Never more than 1 of the 2 slots under the slow journeys and the agent's e2e: the other is kept for the fast lane.
    let worst = 0;
    sampler = setInterval(() => void w.table.leases().then((views) => {
      worst = Math.max(worst, views.filter((v) => v.lease.resource.kind === 'cpu.slot' && slowHolders.has(v.lease.holder)).length);
    }).catch(() => undefined), 15);

    // The stop: its typecheck takes 3 s.
    const s = session();
    const claim = claimId();
    g.holders.set(claim, s);
    const { dir } = makeRepo({ 'src/cart.ts': 'export const total = 3;\n' });
    const stopAt = Date.now();
    const ran = await g.gate.stop({ session: s, claim, cwd: dir, checks: [{ check: TYPECHECK, approved: 'typecheck', on_base: 'passes' }], stopAt });
    clearInterval(sampler);
    sampler = undefined;
    const tc = g.started().find((x) => x.check === TYPECHECK);
    // The Proof's reading: the lane each check took and when it started, from the stop.
    console.log(`AC1 ${plant ?? 'as built'}: ${g.started().map((x) => `${x.check} ${x.lane} lane, started ${x.at - stopAt} ms from the stop`).join('; ')}; the stop's lanes: fast [${ran.fast.join(', ')}], slow [${ran.slow.join(', ')}]; e2e started: ${existsSync(marker)}; slow work held at most ${worst} of 2 slots`);

    expect(ran.fast, `${TYPECHECK}: with two slow journeys running and the agent's e2e waiting on 2 check slots, the 3 s ${TYPECHECK} must be admitted to the fast lane; it went to the ${ran.slow.includes(TYPECHECK) ? 'slow' : 'no'} lane`).toContain(TYPECHECK);
    expect(tc, `${TYPECHECK}: admitted to the fast lane, it must have started`).toBeDefined();
    expect(tc!.lane, `${TYPECHECK}: it ran as a fast-lane run`).toBe('fast');
    expect(tc!.at - stopAt, `${TYPECHECK}: it must start within 1 s of the stop; it started ${tc!.at - stopAt} ms after`).toBeLessThanOrEqual(1000);
    expect(worst, `${TYPECHECK}'s slot: the slow journeys and the agent's e2e together held ${worst} of the 2 cpu.slot leases at once; the pool keeps one for a held stop's fast-lane checks`).toBeLessThanOrEqual(1);
  } finally {
    if (sampler) clearInterval(sampler);
    // Every run and the e2e end on the go file; the record closes once none waits for a slot or runs.
    writeFileSync(g.go, 'go');
    await Promise.race([e2e, sleep(20_000)]);
    await until(() => g.busy() === 0, 20_000);
    await w.close();
  }
}

// ---- The same through the hub: `run.start` is the path the gate runner's runs take to `launch` (runApproved → runStart).
const sh = (cwd: string, go: string): string => {
  const file = join(cwd, 'check.sh');
  writeFileSync(file, `#!/bin/sh\nwhile [ ! -f '${go}' ]; do sleep 0.05; done\n`, { mode: 0o755 });
  return file;
};
async function rpc(hub: Hub, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await conn.call(method, params, timeoutMs);
  } finally {
    conn.close();
  }
}
const startedRuns = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'run.started');
/** The hub's pool is half this machine's cores (`openLeases` in the core); its slow-lane runs may hold all but one. */
async function hubLanes(hub: Hub): Promise<void> {
  const pool = Math.max(1, Math.floor(availableParallelism() / 2));
  const cwd = tempDir();
  const go = join(cwd, 'go');
  const script = sh(cwd, go);
  const base = { claim: claimId(), commit: 'a'.repeat(40), cwd, argv: ['/bin/sh', script], grant: { write: [cwd] } };
  const pending: Promise<unknown>[] = [];
  try {
    for (let i = 0; i < pool; i++) pending.push(rpc(hub, 'run.start', { ...base, check: J, lane: 'slow', expected_ms: 300_000 }, 180_000).catch((e: unknown) => e));
    const slowStarted = async () => startedRuns(await allEvents(hub)).filter((e) => e.data.check === J).length;
    await until(async () => (await slowStarted()) >= pool - 1, 30_000, 200);
    await sleep(1500);
    const t0 = Date.now();
    pending.push(rpc(hub, 'run.start', { ...base, check: TYPECHECK, lane: 'fast', expected_ms: 3000 }, 180_000).catch((e: unknown) => e));
    await until(async () => startedRuns(await allEvents(hub)).some((e) => e.data.check === TYPECHECK), 2500, 100);
    const events = await allEvents(hub);
    const tc = startedRuns(events).find((e) => e.data.check === TYPECHECK);
    const slow = startedRuns(events).filter((e) => e.data.check === J);
    console.log(`AC1 hub ${hub.plant ?? 'as built'}: pool ${pool}; ${slow.length} slow runs started; ${TYPECHECK} ${tc ? `started ${tc.ts - t0} ms after its run.start, lane ${tc.data.lane}` : 'not started'}`);
    expect(tc, `${TYPECHECK}: the hub's fast-lane run must start within 1 s beside ${pool} slow-lane runs on its pool of ${pool}; it had not started after 2.5 s`).toBeDefined();
    expect(tc!.ts - t0, `${TYPECHECK}: the hub's fast-lane run must start within 1 s; it started ${tc!.ts - t0} ms after`).toBeLessThanOrEqual(1000);
    expect(slow.length, `${TYPECHECK}'s slot: ${slow.length} of the hub's ${pool} cpu.slot leases went to slow-lane runs; the pool keeps one for a held stop's fast-lane checks`).toBeLessThanOrEqual(pool - 1);
  } finally {
    writeFileSync(go, 'go');
    await Promise.race([Promise.allSettled(pending), sleep(30_000)]);
  }
}
async function withHub(plant: string | undefined, use: (hub: Hub) => Promise<void>): Promise<void> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build) is not built at ${CLI}`);
  // A hub that doesn't start (a plant the base doesn't list) fails here, never inside the planted judge.
  const hub = await startHub(makeHome(), plant);
  try {
    await use(hub);
  } finally {
    try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
  }
}

describe(`${AC1} a held stop's 3 s typecheck takes the slot kept for the fast lane beside two slow journeys and an agent's e2e`, () => {
  it(`${AC1} with check slots at 2, two slow journeys and an agent's e2e waiting for a cpu.slot lease, the 3 s typecheck is admitted to the fast lane and starts within 1 s of the stop`, async () => {
    await stopBesideBackgroundWork();
  }, 120_000);
  it(`${AC1} (wrong program) a pool that lets slow runs and agents' commands fill every slot (openLeases plant fills-every-slot) sends the typecheck to the slow lane and fails this test, naming the check`, async () => {
    await mustFail('fills-every-slot', () => stopBesideBackgroundWork('fills-every-slot'), [TYPECHECK]);
  }, 120_000);
  it(`${AC1} through the hub: its slow-lane runs never take the last slot of its pool, and its fast-lane typecheck starts within 1 s beside them`, async () => {
    await withHub(undefined, hubLanes);
  }, 240_000);
  it(`${AC1} (wrong program) a hub whose pool lets slow runs fill every slot (DEEP_HUB_PLANT=fills-every-slot) fails this test, naming the check`, async () => {
    await withHub('fills-every-slot', (hub) => mustFail('fills-every-slot', () => hubLanes(hub), [TYPECHECK]));
  }, 240_000);
});

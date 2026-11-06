// #580 AC6: after a run on a warm stack, that run's app processes, database clone and copied volumes are gone, and the
// stack's db still answers. Ending the session, or a change to docker-compose.yml, tears the stack down by its token
// through the supervisor, and its leases end once its processes and containers are proven gone (a reclaim is read the
// same way in pool.test.ts). When the supervisor can't prove a run's app process stopped, the stack is never reused,
// and the next run starts on other leased ports. An environment that stops a run's app by its port fails this test,
// naming the port. The process it can't prove is a helper this test starts outside the hub, on the run's web port on ::1
// beside the app on 127.0.0.1, the way #331's AC10 escapes.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, containers, databases, exists, failureOf, inspect, nameOf, passed, portLease, psql, sleep, stepOf, volumeExists, type Done, type Ev, type Line, type Pending, type Served, type Session } from './helpers.ts';
import { alive, NODE } from '../29/h-d.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

const WHERE = 'main';
/** The run's own things, read while it lasts: its app, its clone, the volume its Redis restarted on, and db. */
interface Own { app: number; clone: string; redisVolume: string; db: string }
async function during(b: Bench, p: Pending): Promise<{ served: Served; own: Own }> {
  const served = await b.served(p);
  const app = b.appOf(served);
  expect(app, `the app of ${p.run} started from its checkout`).toBeDefined();
  const db = containers(served.project, 'db')[0]!;
  const redis = containers(served.project, 'redis')[0]!;
  const volume = (inspect(redis).Mounts as Line[]).find((m) => m.Type === 'volume')?.Name as string;
  return { served, own: { app: app!.pid, clone: nameOf(app!.database), redisVolume: volume, db } };
}
/** Polls until nothing of the project's stays and the port's lease has ended, noting a lease that ended first. */
async function tornDown(b: Bench, served: Served, ids: string[], what: string, ms = 120_000): Promise<void> {
  let early = false;
  await b.until(async () => {
    const events = await b.events();
    const ended = Object.values(served.ports).every((port) => released(events, port, served.run));
    const left = ids.filter(exists);
    if (ended && left.length) early = true;
    return ended && !left.length;
  }, ms, `${what}: ${served.stack}'s containers gone and its leases ended`);
  expect(early, `${what}: a lease of ${served.stack} ended while one of its containers stood`).toBe(false);
}
const released = (events: readonly Ev[], port: number, after: string): boolean => {
  const taken = portLease(events, 'lease.acquired', port).filter((e) => e.log_pos < (events.find((x) => x.kind === 'stack.served' && x.data.run === after)?.log_pos ?? 0));
  const last = taken[taken.length - 1];
  return last !== undefined && portLease(events, 'lease.released', port).some((e) => e.log_pos > last.log_pos);
};
const cleared = async (b: Bench, own: Own): Promise<void> => {
  await b.until(() => !alive(own.app), 30_000, `the run's app process ${own.app} to be gone`);
  await b.until(() => !databases(own.db).includes(own.clone), 30_000, `the run's database clone ${own.clone} to be gone`);
  await b.until(() => !volumeExists(own.redisVolume), 30_000, `the run's copied volume ${own.redisVolume} to be gone`);
};
const change = (s: Session, file: string, edit: (text: string) => string) => async (): Promise<void> => {
  const path = join(s.cwd, file);
  const text = edit(readFileSync(path, 'utf8'));
  await s.call('Write', { file_path: path, content: text }, { effect: () => writeFileSync(path, text) });
};

describe('AC6 #580 a run removes only its own; the stack goes down by its token, and a stack whose cleanup didn\'t finish is never reused', () => {
  it('AC6 a run\'s end removes its app, clone and copied volumes and leaves db answering; a change to docker-compose.yml and the session\'s end each tear the stack down, its leases ending after its containers', async () => {
    const b = bench = await Bench.open();
    const s = await b.session();
    b.hold(WHERE);
    const pending = await b.claim(s);
    const { served, own } = await during(b, pending);
    b.release(WHERE);
    expect((await b.finished(pending)).outcome).toBe('passed');
    await cleared(b, own);
    expect(psql(own.db, 'postgres', 'SELECT 1'), 'the stack\'s db still answers').toBe('1');
    const ids = containers(served.project);
    expect(ids.length, 'the warm stack keeps its services').toBeGreaterThan(0);

    // A changed services key: the whole stack down, a new one up.
    const second = await b.whole(s, { change: change(s, 'docker-compose.yml', (t) => t.replace('POSTGRES_DB: shop', 'POSTGRES_DB: shop\n      SAMPLE_CHANGED: "1"')) });
    passed(second);
    await tornDown(b, served, ids, 'a change to docker-compose.yml');
    expect(stepOf(second.served, 'services').status, 'the services started again').toBe('ran');
    expect(second.served.stack, 'on a new stack').not.toBe(served.stack);

    // The session's end.
    const lastIds = containers(second.served.project);
    expect(lastIds.length).toBeGreaterThan(0);
    await s.hook('SessionEnd', { reason: 'other' });
    await tornDown(b, second.served, lastIds, 'the session\'s end');
  }, 1_500_000);

  async function unproven(plant?: string): Promise<{ first: Served; next: Done; helper: number; port: number; helperAlive: boolean }> {
    const b = bench = await Bench.open(plant ? { plant } : {});
    const s = await b.session();
    b.hold(WHERE);
    const pending = await b.claim(s);
    const { served, own } = await during(b, pending);
    const port = served.ports.web!;
    const child = spawn(NODE, ['-e', `require('net').createServer().listen(${port}, '::1')`], { stdio: 'ignore', detached: true, env: {} });
    child.unref();
    b.ownHelper(child.pid!);
    await sleep(1000);
    b.release(WHERE);
    await b.finished(pending);
    await b.until(() => !alive(own.app), 30_000, `the app of ${pending.run} to end`);
    const helperAlive = alive(child.pid!);
    const next = await b.whole(s);
    return { first: served, next, helper: child.pid!, port, helperAlive: helperAlive && alive(child.pid!) };
  }
  function neverReused(u: Awaited<ReturnType<typeof unproven>>): void {
    expect(u.helperAlive, `the helper (pid ${u.helper}) the supervisor can't prove was stopped by the port ${u.port}`).toBe(true);
    expect(u.next.served.stack, 'the stack is never reused').not.toBe(u.first.stack);
    expect(u.next.served.ports.web, 'the next run starts on other leased ports').not.toBe(u.first.ports.web);
    expect(stepOf(u.next.served, 'services').status, 'cold').toBe('ran');
  }
  it('AC6 when the supervisor can\'t prove a process of the run stopped, the stack is never reused and the next run starts on other leased ports, the process left alone', async () => {
    neverReused(await unproven());
  }, 1_500_000);

  it('AC6 (wrong program) an environment that stops a run\'s app by its port (DEEP_HUB_PLANT=env-kills-by-port) fails this test, naming the port', async () => {
    let port = 0;
    const failure = await failureOf(async () => { const u = await unproven('env-kills-by-port'); port = u.port; neverReused(u); });
    expect(port, `the scenario formed: a run held its web port with the helper beside it (it ended: ${failure})`).toBeGreaterThan(0);
    expect(failure, 'the planted environment passed').not.toBeNull();
    expect(failure, 'naming the port').toContain(String(port));
  }, 1_500_000);
});

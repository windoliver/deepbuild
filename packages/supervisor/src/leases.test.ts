import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openAsks } from '@deepbuild/asks';
import { openLeases } from '@deepbuild/leases';
import { openRecord, type Event, type RecordStore } from '@deepbuild/record';
import { afterEach, expect, test } from 'vitest';
import { openSupervisor } from './index.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const events = async (record: RecordStore, kind: string): Promise<Event[]> => (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === kind);

// With the kernel's lease table (#237), a run's keys are the table's leases: a key a session holds there is passed
// over, and the run's lease ends citing the process.ended that proves its process gone.
test("a run's keys are the lease table's, and its release cites the proof its process is gone", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  await leases.declare('test-phones', { name: 'phone', match: 'exact', cap: 10, cooldown: 0, cost: 0 });
  const session = await leases.lease({ holder: 'session:A1' }, { host: 'local', kind: 'phone', key: '+15550100' }, 'exclusive');
  expect(session.status).toBe('granted');
  const sup = await openSupervisor({
    record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, leases,
    resources: [{ kind: 'phone', keys: ['+15550100', '+15550101'] }],
  });
  try {
    const started = await sup.start({ run: 'run:PHONE', argv: ['/usr/bin/true'], cwd: dir, leases: [{ kind: 'phone' }] });
    expect(started.status === 'started' && started.leases).toEqual([{ kind: 'phone', key: '+15550101' }]);
    const acquired = (await events(record, 'lease.acquired')).find((e) => (e.data as { run?: string }).run === 'run:PHONE');
    expect(acquired?.data).toMatchObject({ holder: 'core', resource: { key: '+15550101' } });
    await sup.wait('run:PHONE');
    await sup.cleanup('run:PHONE');
    const gone = (await events(record, 'process.ended')).filter((e) => (e.data as { run: string }).run === 'run:PHONE').map((e) => e.id);
    const released = (await events(record, 'lease.released')).find((e) => e.subject === acquired?.subject);
    expect(gone.length).toBeGreaterThan(0);
    expect((released?.data as { proof?: string[] }).proof).toEqual(gone);
    expect((await leases.leases()).map((v) => v.lease.resource.key)).toEqual(['+15550100']);
  } finally {
    await sup.close();
    await record.close();
  }
}, 60_000);

// A run's process that its cleanup can't prove its own (#44): recorded with the run token, it re-execs itself with
// another, so the cleanup leaves it running, unfinished. Checked again until it is gone (by the same supervisor, by
// one opened again on the record, or with a child it forks after the cleanup), each end is recorded, and a
// package's lease on the run ends citing them; until then the lease holds.
const variants = [
  { name: 'by the same supervisor', restart: false, fork: false },
  { name: 'by a supervisor opened again on the record', restart: true, fork: false },
  { name: 'with a child it forks after the cleanup', restart: false, fork: true },
];
test.each(variants)("an unfinished run's processes are checked again until gone, $name, and a package's lease on the run then ends citing their ends", async ({ restart, fork }) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  await leases.declare('acme/x', { name: 'device.rig', match: 'exact', cap: 10, cooldown: 0, cost: 0 });
  const options = { record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, leases };
  let sup = await openSupervisor(options);
  const run = `run:LINGER${Date.now()}${Math.random().toString(36).slice(2)}`;
  const child = "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { detached: true, stdio: 'ignore' }).unref()";
  const after = fork ? `setTimeout(() => { ${child} }, 1500); setTimeout(() => {}, 2500)` : 'setTimeout(() => {}, 3000)';
  const forged = `setTimeout(() => process.execve(process.execPath, [process.execPath, '-e', ${JSON.stringify(after)}], { ...process.env, DEEP_RUN_TOKEN: 'forged' }), 300)`;
  const ends = async (): Promise<Event[]> => (await events(record, 'process.ended')).filter((e) => (e.data as { run: string }).run === run);
  try {
    const started = await sup.start({ run, argv: [process.execPath, '-e', forged], cwd: dir, grant: { read: [dirname(dirname(process.execPath))] } });
    if (started.status !== 'started') throw Error('it starts');
    const granted = await leases.lease({ holder: 'ext:acme/x', run }, { host: 'local', kind: 'device.rig', key: 'rig-1' }, 'exclusive');
    expect(granted.status).toBe('granted');
    await new Promise((r) => setTimeout(r, 1000));
    const cleaned = await sup.cleanup(run);
    expect(cleaned.outcome, 'its cleanup leaves the re-exec running').toBe('unfinished');
    expect(cleaned.left).toContain(`pid:${started.pid}`);
    if (restart) {
      await sup.close();
      sup = await openSupervisor(options);
    }
    await sup.tick();
    await leases.tick();
    expect((await leases.leases()).map((v) => v.lease.holder), 'held while it runs').toEqual(['ext:acme/x']);
    const running = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const until = Date.now() + 20_000; Date.now() < until && (await leases.leases()).length; await new Promise((r) => setTimeout(r, 50))) {
      await sup.tick();
      await leases.tick();
      const pids = (await ends()).map((e) => (e.data as { pid: number }).pid);
      for (const pid of pids) expect(running(pid), `pid ${pid}'s end is recorded while it still runs`).toBe(false);
      // The forked child outlives its parent: its parent's end alone never ends the lease.
      if (fork && pids.includes(started.pid) && pids.length === 1) expect((await leases.leases()).length, 'held while its child runs').toBe(1);
    }
    const gone = await ends();
    expect(gone.map((e) => (e.data as { pid: number }).pid), 'each end is recorded once it exits').toEqual(fork ? [started.pid, expect.any(Number)] : [started.pid]);
    expect(await leases.leases(), 'the lease ends').toEqual([]);
    const released = (await events(record, 'lease.released')).find((e) => (e.data as { holder: string }).holder === 'ext:acme/x');
    expect((released?.data as { proof: string[] }).proof).toEqual(gone.map((e) => e.id));
  } finally {
    await sup.close();
    await record.close();
  }
}, 60_000);

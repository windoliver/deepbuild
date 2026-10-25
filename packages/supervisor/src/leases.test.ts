import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

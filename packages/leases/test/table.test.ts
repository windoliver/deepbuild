// The lease table's rule beyond #237's acceptance suite: its state is a function of the record. A table opened
// again on the log keeps each lease with the run whose processes hold it open, so a holder that ends while its
// run's process still runs keeps the lease until the supervisor's proof; and a lease the supervisor recorded for
// a run is in the same table, so a session's lease on its key is refused until the supervisor releases it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRecord, ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { openLeases } from '../src/index.js';

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const now = (): number => T0;
const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const port = { host: 'local', kind: 'port', key: '3000' };
const PORT = { name: 'port', match: 'exact', cap: 1000, cooldown: 0, cost: 0 };

let dir: string;
let record: RecordStore;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-leases-'));
  record = await openRecord({ path: join(dir, 'record.db'), now });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});
const append = (connection: Connection, kind: string, subject: string, data: Record<string, unknown>) =>
  record.append(connection, { v: 1, id: ulid(T0), kind, subject, ts: T0, data: data as never });
const endSession = (holder: string) =>
  append({ writer: 'hook', actor: 'you', scope: 'you', session: holder.slice('session:'.length), agent: 'claude-code' }, 'session.end', holder, { reason: 'prompt_input_exit' });

describe('a table opened again on the log', () => {
  it('keeps a lease open while a process of its run runs, and releases it on the proof', async () => {
    const run = `run:${ulid(T0)}`;
    const holder = `session:${ulid(T0)}`;
    await append(core, 'process.tracked', run, { run, pid: 4242, start: 'Sat Oct 24 12:00:00 2026', pgid: 4242, cwd: dir, token: null });
    const first = await openLeases({ record, now });
    await first.declare('env-local', PORT);
    expect((await first.lease({ holder, run }, port, 'exclusive')).status).toBe('granted');

    const again = await openLeases({ record, now });
    await again.declare('env-local', PORT);
    await endSession(holder);
    await again.tick();
    expect((await again.leases()).map((v) => v.lease.holder), 'still held while pid 4242 of its run runs').toEqual([holder]);
    const ended = await append(core, 'process.ended', run, { run, pid: 4242 });
    await again.tick();
    expect(await again.leases()).toEqual([]);
    const [released] = (await record.read({ after: ended.log_pos })).filter((e) => e.kind === 'lease.released');
    expect((released?.data as { proof?: string[] }).proof).toHaveLength(2);
  });

  it('ends only the lease a release names, when its holder holds another on the same key', async () => {
    const table = await openLeases({ record, now });
    await table.declare('env-local', PORT);
    const a = await table.lease({ holder: 'ext:acme/x' }, port, 'exclusive');
    const b = await table.lease({ holder: 'ext:acme/x' }, port, 'exclusive');
    if (a.status !== 'granted' || b.status !== 'granted') throw Error('both are granted to one holder');
    await table.release(b.lease.id, []);
    expect((await table.leases()).map((v) => v.lease.id), 'the other lease is still held').toEqual([a.lease.id]);
    const again = await openLeases({ record, now });
    expect((await again.leases()).map((v) => v.lease.id), 'and so it reads from the log').toEqual([a.lease.id]);
  });

  it("refuses one holder's run an exclusive key another of its runs holds, and grants it to the same run", async () => {
    const table = await openLeases({ record, now });
    await table.declare('env-local', PORT);
    const [a, b] = [`run:${ulid(T0)}`, `run:${ulid(T0 + 1)}`];
    expect((await table.lease({ holder: 'ext:acme/x', run: a }, port, 'exclusive')).status).toBe('granted');
    const refused = await table.lease({ holder: 'ext:acme/x', run: b }, port, 'exclusive');
    expect(refused.status === 'refused' && refused.message, 'a process of the other run may still use it').toMatch(/held by ext:acme\/x/);
    expect((await table.lease({ holder: 'ext:acme/x', run: a }, port, 'exclusive')).status).toBe('granted');
  });

  it('holds a lease the supervisor recorded for a run, until the supervisor releases it', async () => {
    const run = `run:${ulid(T0)}`;
    const lease = { resource: port, holder: 'core', mode: 'exclusive', expires: T0 + 60_000 };
    await append(core, 'lease.acquired', run, lease);
    const table = await openLeases({ record, now });
    await table.declare('env-local', PORT);
    const refused = await table.lease({ holder: `session:${ulid(T0)}` }, port, 'exclusive');
    expect(refused.status === 'refused' && refused.message).toMatch(/held by core/);
    await append(core, 'lease.released', run, lease);
    expect((await table.lease({ holder: `session:${ulid(T0)}` }, port, 'exclusive')).status).toBe('granted');
  });
});

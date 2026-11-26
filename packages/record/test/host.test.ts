// The host an event's connection came over (#999): kept with the event as its session, project and agent are, part of
// what tells a repeated append from a conflicting one, and added to a record made before events named one.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { fixtures } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord } from '../src/index.js';
import type { Connection, EventInput } from '../src/index.js';

const S = '7c4d5e60-0999-4222-8333-444455550997';
const start = (id: string): EventInput => ({ v: 1, id, kind: 'session.start', ts: 1_760_013_451_000, seq: '1760013451000000000', data: (fixtures('session.start@1')[0] as { data: JsonValue }).data });
const hook = (host?: string): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session: S, agent: 'claude-code', ...(host ? { host } : {}) });

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('keeps the host of the connection an event came over, and none for one from this machine', async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-record-host-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  try {
    await record.append(hook('gpu-box'), start('01K74FKZVK8Q2X5R7M3N9P4T60'));
    await record.append({ ...hook(), session: `${S}-here` }, start('01K74FKZVK8Q2X5R7M3N9P4T61'));
    const [on, here] = await record.read({ after: 0 });
    expect([on!.host, here!.host]).toEqual(['gpu-box', undefined]);
    // The same event again is the one in the log; the same ID from another host is another event's content.
    expect((await record.append(hook('gpu-box'), start('01K74FKZVK8Q2X5R7M3N9P4T60'))).existing).toBe(true);
    await expect(record.append(hook('pi4'), start('01K74FKZVK8Q2X5R7M3N9P4T60'))).rejects.toMatchObject({ code: 'conflict' });
  } finally {
    await record.close();
  }
});

it('the core\'s own events about a session on a host, or about a claim it made, carry that host; a hook that only names the session carries none', async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-record-host-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
  const at = 1_760_013_452_000;
  try {
    await record.append(hook('gpu-box'), start('01K74FKZVK8Q2X5R7M3N9P4T64'));
    await record.append({ ...core, session: S }, { v: 2, id: '01K74FKZVK8Q2X5R7M3N9P4T65', kind: 'session.attention', ts: at, subject: `session:${S.replaceAll('-', '')}`, data: { state: 'unknown' } });
    await record.append({ ...core, session: S }, { v: 2, id: '01K74FKZVK8Q2X5R7M3N9P4T66', kind: 'claim.made', ts: at + 1, data: { task_ref: 'session:x#0', attempt: 1, commit: '0'.repeat(40), scope: 'session', predictions: [] } });
    // A verdict names its claim alone, as the done gate appends it.
    await record.append(core, { v: 1, id: '01K74FKZVK8Q2X5R7M3N9P4T67', kind: 'verdict.stale', ts: at + 2, subject: 'claim:01K74FKZVK8Q2X5R7M3N9P4T66', data: { verdict: 'verdict:01K74FKZVK8Q2X5R7M3N9P4T60', because: 'its commit moved' } });
    // The same session named on a connection of this machine's: the host is the link's, never the session's.
    await record.append(hook(), { ...start('01K74FKZVK8Q2X5R7M3N9P4T68'), seq: '1760013451000000002' });
    expect((await record.read({ after: 0 })).map((e) => [e.kind, e.host])).toEqual([
      ['session.start', 'gpu-box'], ['session.attention', 'gpu-box'], ['claim.made', 'gpu-box'], ['verdict.stale', 'gpu-box'], ['session.start', undefined],
    ]);
  } finally {
    await record.close();
  }
});

it('a record made before events named their host gains the column, its events from this machine and appended once', async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-record-host-'));
  const path = join(dir, 'ledger.db');
  let record = await openRecord({ path, now: Date.now });
  await record.append(hook(), start('01K74FKZVK8Q2X5R7M3N9P4T62'));
  await record.close();
  const db = new Database(path);
  db.exec('ALTER TABLE events DROP COLUMN host');
  db.close();
  record = await openRecord({ path, now: Date.now });
  try {
    const [before] = await record.read({ after: 0 });
    expect(before!.host).toBeUndefined();
    // Its hash is the one it had before the column: the same append is still the event in the log.
    expect((await record.append(hook(), start('01K74FKZVK8Q2X5R7M3N9P4T62'))).existing).toBe(true);
    await record.append(hook('gpu-box'), { ...start('01K74FKZVK8Q2X5R7M3N9P4T63'), seq: '1760013451000000001' });
    expect((await record.read({ after: 0 })).map((e) => e.host)).toEqual([undefined, 'gpu-box']);
  } finally {
    await record.close();
  }
});

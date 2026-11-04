// Regression tests for the record's lifecycle gate (#570) beyond its acceptance suite: each failed on a63d81a0,
// the gate as first written.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, ulid } from '../src/index.js';
import type { Connection, RecordStore } from '../src/index.js';

const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const fixture = (name: string): Record<string, JsonValue> =>
  JSON.parse(readFileSync(new URL(`../../contracts/fixtures/${name}/01.json`, import.meta.url), 'utf8')).data;
const resource = { host: 'local', kind: 'cpu.slot', key: '0' };
const lease = (extra: Record<string, JsonValue> = {}) => ({ resource, holder: 'session:S1', mode: 'exclusive', expires: T0 + 60_000, ...extra });
const T0 = 1_760_013_451_000;

let t = T0;
const dirs: string[] = [];
const opened: RecordStore[] = [];
async function open(path?: string): Promise<{ record: RecordStore; path: string }> {
  const at = path ?? join(dirs[dirs.push(mkdtempSync(join(tmpdir(), 'deep-record-lifecycle-'))) - 1]!, 'record.db');
  const record = await openRecord({ path: at, now: () => t });
  opened.push(record);
  return { record, path: at };
}
afterEach(async () => {
  for (const r of opened.splice(0)) await r.close().catch(() => undefined);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const leaseRow = async (record: RecordStore) => (await record.table('leases')).rows[0]?.state;
const refusals = async (record: RecordStore) => (await record.read({ after: 0 })).filter((e) => e.kind === 'move.refused');

it("a check run's slot, released once its processes are gone with no event to cite, is released", async () => {
  // The hub releases a run's cpu.slot with an empty proof once the leases table read its processes gone.
  const { record } = await open();
  await record.append(core, { v: 2, id: ulid(++t), kind: 'lease.acquired', subject: `lease:${ulid(t)}`, ts: t, data: lease() });
  await record.append(core, { v: 2, id: ulid(++t), kind: 'lease.released', subject: `lease:${ulid(t)}`, ts: t, data: lease({ proof: [] }) });
  expect(await leaseRow(record)).toBe('released');
  expect(await refusals(record)).toEqual([]);
});

it('a release refused for citing an event not yet in the log stays refused when a rebuild finds that event later', async () => {
  const { record } = await open();
  await record.append(core, { v: 2, id: ulid(++t), kind: 'lease.acquired', subject: `lease:${ulid(t)}`, ts: t, data: lease() });
  const later = ulid(t + 5);
  await record.append(core, { v: 2, id: ulid(++t), kind: 'lease.released', subject: `lease:${ulid(t)}`, ts: t, data: lease({ proof: [later] }) });
  expect(await leaseRow(record)).toBe('held');
  t += 5;
  await record.append({ ...core, session: 'S1' }, { v: 1, id: later, kind: 'session.gone', subject: 'session:S1', ts: t, data: fixture('session.gone@1') });
  await record.rebuild();
  expect(await leaseRow(record), 'the rebuild reads the log as it stood at the release').toBe('held');
  expect((await refusals(record)).length).toBe(1);
});

it('a refused move of an object named by long text is recorded, and the event still lands', async () => {
  const { record } = await open();
  const item = { ...fixture('open_item.closed@2'), task_ref: `task:${ulid(t)}`, text: 'x'.repeat(8192) };
  await record.append(core, { v: 2, id: ulid(++t), kind: 'open_item.opened', ts: t, data: { ...fixture('open_item.opened@2'), task_ref: item.task_ref, text: item.text } });
  await record.append(core, { v: 2, id: ulid(++t), kind: 'open_item.closed', ts: t, data: item });
  const again = ulid(++t);
  await expect(record.append(core, { v: 2, id: again, kind: 'open_item.closed', ts: t, data: item })).resolves.toMatchObject({ existing: false });
  const [refused] = await refusals(record);
  expect((refused?.data as { event_id: string }).event_id).toBe(again);
});

it('a record made before the gate rebuilds to what it held: the moves it accepted then still stand', async () => {
  const { record, path } = await open();
  const ask = ulid(++t);
  await record.append(core, { v: 4, id: ask, kind: 'ask.created', ts: t, data: { ...fixture('ask.created@4'), deadline: t } });
  await record.append(core, { v: 1, id: ulid(++t), kind: 'ask.defaulted', subject: `ask:${ask}`, ts: t, data: { answer: 'hold', plan_hash: null, decision: 'deny' } });
  await record.close();
  // As the record before the gate kept it: an answer after the default in the log, and no lifecycle boundary in meta.
  const db = new Database(path);
  const last = db.prepare('SELECT * FROM events ORDER BY log_pos DESC LIMIT 1').get() as Record<string, unknown>;
  db.prepare('INSERT INTO events (id, log_pos, v, ts, project_id, session_id, seq, agent, writer, actor, scope, kind, subject, data, evidence, hash, unverified) VALUES (?, ?, 4, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, 0)')
    .run(ulid(++t), Number(last.log_pos) + 1, t, 'core', 'you', 'you', 'ask.answered', `ask:${ask}`, JSON.stringify(fixture('ask.answered@4')), 'planted');
  db.prepare("DELETE FROM meta WHERE key = 'lifecycle_from'").run();
  db.prepare("UPDATE meta SET value = ? WHERE key = 'log_block_end'").run(String(Number(last.log_pos) + 2));
  db.close();
  const { record: again } = await open(path);
  await again.rebuild();
  expect((await again.table('asks')).rows.find((r) => r.id === ask)?.status).toBe('answered');
  expect(await refusals(again)).toEqual([]);
});

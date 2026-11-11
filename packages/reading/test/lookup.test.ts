// #2024's Scope beyond its acceptance tests: ⌘K and `deep open` take what people paste, a PR URL or `#n`, a commit
// SHA or a prefix of 7 or more, a branch, a session ID or a prefix of it, and an agent app link, each naming what the
// record ties to it, newest first when several match; a reference nothing names says so with the kinds it takes.
// Real record in a temp folder.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openRecord, openRecordReader, ulid, type RecordStore } from '@deepbuild/record';
import { lookup, referenceAddress } from '../src/index.ts';

const dirs: string[] = [];
const records: RecordStore[] = [];
afterEach(async () => {
  for (const r of records.splice(0)) await r.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
let t = Date.now() - 3_600_000;
const tick = () => (t += 1000);
const SHA = 'a3f9c2e71b5d40c8e2f6a1b9d7c3e5f0a2b4c6d8';
const PR = 'https://github.com/acme/shop/pull/412';

test('each kind of pasted reference names the sessions the record ties to it, newest first, and one nothing names lists the kinds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookup2024-'));
  dirs.push(dir);
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => t });
  records.push(record);
  const start = async (session: string, branch: string): Promise<void> => {
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, project: 'shop', agent: 'codex' }, { v: 1, id: ulid(tick()), kind: 'session.start', ts: t, data: { agent: 'codex', worktree: dir, branch, thread: session } });
  };
  const older = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  const newer = '0199f7e6-d5c4-7b3a-9281-706f5e4d3c2b';
  await start(older, 'fix/totals');
  await record.append({ writer: 'core', actor: 'you', scope: 'you', session: older }, { v: 1, id: ulid(tick()), kind: 'commit.made', ts: t, subject: `session:${older.replace(/-/g, '')}`, data: { sha: SHA, worktree: dir, branch: 'fix/totals' } });
  await start(newer, 'fix/totals');
  await record.append({ writer: 'core', actor: 'you', scope: 'you', session: newer }, { v: 1, id: ulid(tick()), kind: 'session.reading', ts: t, subject: `session:${newer.replace(/-/g, '')}`, data: { reading: `Opened pull request ${PR}` } });
  await record.sync();
  const reader = openRecordReader({ path: join(dir, 'ledger.db') });
  try {
    const named = async (query: string): Promise<string[]> => (await lookup(reader, query, { references: true })).hits.map((h) => h.address ?? '');
    expect(await named(SHA.slice(0, 7))).toEqual([`session/${older}`]);
    expect(await named(SHA)).toEqual([`session/${older}`]);
    expect(await named(PR)).toEqual([`session/${newer}`]);
    expect(await named('#412')).toEqual([`session/${newer}`]);
    expect(await named('fix/totals')).toEqual([`session/${newer}`, `session/${older}`]);
    expect(await named(newer.slice(0, 13))).toEqual([`session/${newer}`]);
    expect(await named(older.replace(/-/g, ''))).toEqual([`session/${older}`]);
    expect(await named(`codex://threads/${older}`)).toEqual([`session/${older}`]);
    const none = await lookup(reader, 'b7e1d0c9f8');
    expect(none.hits).toEqual([]);
    for (const kind of [/PR/, /issue/, /#n/, /SHA/, /branch/, /session ID/, /link/, /ask/]) expect(none.none).toMatch(kind);
  } finally {
    reader.close();
  }
  expect(await referenceAddress('fix/totals', dir)).toEqual({ address: `session/${newer}` });
  expect(await referenceAddress('b7e1d0c9f8', dir)).toEqual({ none: expect.stringMatching(/Nothing names "b7e1d0c9f8"/) });
});

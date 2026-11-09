// deep_search's past sessions (#1515) on a real record: a reply stays under #63's cap and the rest goes by cursor,
// every hit once, each marked as history with its agent, date, whose words and what changed since.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { CAP } from '@deepbuild/reading';
import { openRecord, ulid, type Connection } from '@deepbuild/record';
import { aboutSessions, search } from '../src/search.js';

const T0 = 1_760_013_451_000;
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

it('cuts a reply at the cap and continues it by cursor, each past-session hit once and marked as history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deep-past-'));
  roots.push(root);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => T0, evidence: store });
  const S = 'sa1';
  const core: Connection = { writer: 'core', actor: 'you', scope: 'you', session: S };
  await record.append({ ...core, writer: 'hook' }, { v: 1, id: ulid(T0), kind: 'session.start', ts: T0, data: { agent: 'codex', worktree: '/tmp/shop', branch: 'main', thread: S } });
  // Thirty messages of yours, each longer than a quote holds: twenty quotes alone pass the cap.
  const lines = Array.from({ length: 30 }, (_, n) => JSON.stringify({ type: 'user', uuid: `m${n}`, message: { role: 'user', content: `lantern ${n} ${'pool timeout '.repeat(60)}` } }));
  const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new Uint8Array(Buffer.from(`${lines.join('\n')}\n`)), kind: 'transcript', source: 'codex', redaction: 'complete', license: { name: 'own', allows: [] } });
  if (put.status !== 'stored') throw Error('transcript not stored');
  await record.append(core, { v: 1, id: ulid(T0 + 1), kind: 'transcript.archived', ts: T0 + 1, data: { session: `session:${S}`, evidence: put.evidence.sha256 } });
  await record.indexTranscripts();
  const past = {
    sessions: [S], messages: (terms: readonly (readonly string[])[], ids: readonly string[]) => record.findMessages(terms, ids),
    about: async (ids: readonly string[]) => new Map(ids.map((id) => [id, { agent: 'codex', date: T0, changed: ['src/retry.ts changed at 0123456789ab, after this session'] }])),
  };
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const reply = await search({ query: 'lantern', index: undefined, raw: (q, p) => record.raw(q, p), worktree: undefined, session: 'caller', covers: () => false, readings: async () => [], past, ...(cursor ? { cursor } : {}) });
    expect(JSON.stringify(reply).length, `page ${page} stays under the cap`).toBeLessThanOrEqual(CAP);
    for (const h of reply.hits) {
      expect(h).toMatchObject({ history: true, agent: 'codex', from: 'you', date: new Date(T0).toISOString(), changed: [expect.stringContaining('src/retry.ts')] });
      seen.push(h.source);
    }
    cursor = reply.next;
    if (!cursor) break;
  }
  expect(seen, 'every message once, in order').toEqual(Array.from({ length: 30 }, (_, n) => `session:${S}#m${n}`));
  await record.close();
});

it('marks a session whose commit the branch head reverts, and not one whose commit stands', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-revert-')));
  roots.push(root);
  const repo = join(root, 'shop');
  const git = (at: number, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: `@${at / 1000}`, GIT_COMMITTER_DATE: `@${at / 1000}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
  execFileSync('mkdir', ['-p', join(repo, 'src')]);
  git(T0, 'init', '-q');
  const commit = (at: number, file: string, text: string) => { writeFileSync(join(repo, file), text); git(at, 'add', '-A'); git(at, 'commit', '-q', '-m', `edit ${file}`); return git(at, 'rev-parse', 'HEAD'); };
  commit(T0, 'src/retry.ts', 'base\n');
  commit(T0, 'src/pool.ts', 'base\n');
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => T0, evidence: store });
  const session = async (id: string, at: number, file: string) => {
    const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: id };
    await record.append(hook, { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: repo, branch: 'main', thread: id } });
    await record.append(hook, { v: 3, id: ulid(at + 1), kind: 'tool.after', ts: at + 1, data: { kind: 'edit', paths: [join(repo, file)], command: null, call: `c${id}`, outcome: 'ok' } });
    const sha = commit(at + 60_000, file, `fix by ${id}\n`);
    await record.append({ ...hook, writer: 'core' }, { v: 1, id: ulid(at + 60_000), kind: 'commit.made', subject: `session:${id}`, ts: at + 60_000, data: { sha, worktree: repo, branch: 'main' } });
    await record.append(hook, { v: 1, id: ulid(at + 120_000), kind: 'session.end', ts: at + 120_000, data: { reason: 'other' } });
    return sha;
  };
  const reverted = await session('sr1', T0 + 3_600_000, 'src/retry.ts');
  await session('sk1', T0 + 7_200_000, 'src/pool.ts');
  git(T0 + 10_800_000, 'revert', '--no-edit', reverted);
  const about = await aboutSessions((sql, params) => record.raw(sql, params), ['sr1', 'sk1']);
  expect(about.get('sr1')?.task, 'the session whose commit was reverted is marked so').toMatch(/^reverted: [0-9a-f]{12} reverts its commit$/);
  expect(about.get('sr1')?.changed, 'and the revert changed its file after it').toEqual([expect.stringContaining('src/retry.ts changed at')]);
  expect(about.get('sk1')?.task, 'a session whose commit stands carries no mark').toBeUndefined();
  expect(about.get('sk1')?.changed, 'nor a change it made itself').toEqual([]);
  await record.close();
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures, type JsonValue } from '@deepbuild/contracts';
import { openRecord } from '@deepbuild/record';
import { verdictLine } from '@deepbuild/verdicts';
import { expect, it, vi } from 'vitest';
import { shadowedBy, topLevel } from '../src/claude-settings.js';
import { repoOf, statusRows, UNREAD_WINDOW } from '../src/status.js';
import { claimState, newestClaim } from '../src/verdict-chat.js';
import { ulid } from '../src/wire.js';

const folders = vi.hoisted(() => ({ on: false, reads: 0 }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  const counted = <A extends unknown[], R>(read: (...args: A) => R) => (...args: A): R => {
    if (folders.on) folders.reads++;
    return read(...args);
  };
  return { ...actual, existsSync: counted(actual.existsSync), readFileSync: counted(actual.readFileSync as (...args: unknown[]) => unknown), statSync: counted(actual.statSync as (...args: unknown[]) => unknown) };
});

type Data = Record<string, JsonValue>;
const data = (kind: string): Data => (fixtures(kind)[0] as { data: Data }).data;

it('a session more in a worktree the record holds adds no read to deep status, and every row says what its own read says', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-status-rows-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  let at = Date.now() - 3_600_000;
  const [alpha, beta] = [join(dir, 'alpha'), join(dir, 'beta')];
  for (const repo of [alpha, beta]) mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(beta, '.claude'));
  writeFileSync(join(beta, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-own-line' } }));
  const session = (n: number) => `7c4d5e60-0019-4222-8333-${String(n).padStart(12, '0')}`;
  const who = (writer: string, id: string) => ({ writer, actor: 'you', scope: 'you', session: id });
  const subject = (id: string) => `session:${id.replace(/[^0-9A-Za-z]/g, '')}`;
  const turn = async (n: number, worktree: string) => {
    const id = session(n);
    await record.append(who('hook', id), { v: 1, id: ulid(++at), kind: 'session.start', ts: at, data: { ...data('session.start@1'), agent: 'claude-code', worktree, thread: id } });
    await record.append(who('hook', id), { v: 1, id: ulid(++at), kind: 'user.ask', ts: at, data: { msg: 1, text: 'tidy the imports', tasks: [], from: 'person' } });
    await record.append(who('hook', id), { v: 1, id: ulid(++at), kind: 'agent.stop', ts: at, seq: `${BigInt(at) * 1_000_000n}`, subject: subject(id), data: data('agent.stop@1') });
  };
  const claim = async (n: number, outcome: 'PASS' | 'FAIL') => {
    const made = ulid(++at);
    await record.append(who('core', session(n)), { v: 3, id: made, kind: 'claim.made', ts: at, data: data('claim.made@3') });
    await record.append(who('core', session(n)), { v: 1, id: ulid(++at), kind: 'verdict.made', ts: at, data: { ...data('verdict.made@1'), claim: `claim:${made}`, outcome, verdict: `verdict:${ulid(++at)}`, ...(outcome === 'PASS' ? { reasons: [], requirements: [], smallest: null, points_to: null } : {}) } });
  };
  try {
    for (const n of [1, 2, 3, 4]) await turn(n, n % 2 ? alpha : beta);
    await claim(1, 'FAIL');
    await claim(1, 'PASS');
    await claim(2, 'FAIL');
    let queries = 0;
    const query = (sql: string) => { queries++; return record.raw(sql); };
    const read = async () => {
      [queries, folders.reads, folders.on] = [0, 0, true];
      try {
        return { rows: await statusRows(query, at + 1), queries, folders: folders.reads };
      } finally {
        folders.on = false;
      }
    };
    const four = await read();
    for (let n = 5; n <= 40; n++) await turn(n, n % 2 ? alpha : beta);
    const forty = await read();
    expect(forty.rows.map((r) => r.id).sort()).toEqual(Array.from({ length: 40 }, (_, i) => session(i + 1)).sort());

    const plain = (sql: string) => record.raw(sql);
    for (const row of forty.rows) {
      const worktree = Number(row.id.slice(-12)) % 2 ? alpha : beta;
      const newest = await newestClaim(plain, row.id);
      const state = newest === undefined ? undefined : await claimState(plain, newest, new Map());
      const shadow = shadowedBy(topLevel(worktree))[0];
      expect({ repo: row.repo, verdict: row.verdict, readings: row.readings }, row.id).toEqual({
        repo: repoOf(worktree), verdict: state ? verdictLine(state.state) : undefined,
        readings: shadow ? [`${UNREAD_WINDOW} ${shadow.file} sets ${shadow.key}, which runs instead of DeepBuild's status line forwarder, so this session's plan windows aren't read`] : undefined,
      });
    }
    const of = (n: number) => forty.rows.find((r) => r.id === session(n))!;
    expect([of(1).repo, of(2).repo]).toEqual(['alpha', 'beta']);
    expect([of(1).verdict, of(2).verdict, of(3).verdict]).toEqual([expect.stringMatching(/^PASS/), expect.stringMatching(/^sent back/), undefined]);
    expect([of(1).readings, of(2).readings?.[0]]).toEqual([undefined, expect.stringContaining('statusLine.command')]);

    expect({ queries: forty.queries, folders: forty.folders }, 'the reads for 40 sessions, against those for 4 in the same two worktrees').toEqual({ queries: four.queries, folders: four.folders });
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

// The core's floor at a claim (#29): a definition whose recomputed hash differs from the locked one makes the claim
// INVALID, naming what changed, whatever done gate is installed; an unchanged one records no verdict. Real record,
// real git repo; the definition locked through the kernel's own path (#303), its check's bytes kept by their SHA-256
// as the hub's evidence store keeps them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord, ulid, type Connection } from '@deepbuild/record';
import { AskTasks } from '../src/ask-tasks.js';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const CHECK = '.deepbuild/checks/total.sh';
const ASK = 'make the receipt show the rounded total';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

async function claimAfter(change: (repo: string) => void) {
  dir = mkdtempSync(join(tmpdir(), 'floor-'));
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.deepbuild/checks'), { recursive: true });
  writeFileSync(join(repo, CHECK), '#!/bin/sh\nexit 1\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const drafts = join(dir, 'drafts.json');
  writeFileSync(drafts, JSON.stringify({ drafts: [{ ask: ASK, requirements: [{ id: 'R1', text: 'the receipt shows $18.01', source_line: 'ask', refuted_by: 'x', check: CHECK, depth: 'unit', oracle: 'code' }], deliverables: [] }] }));
  let t = 1_760_000_000_000;
  const now = () => (t += 1000);
  const record = await openRecord({ path: join(dir, 'record.db'), now });
  const as = (writer: string, session: string): Connection => ({ writer, actor: 'you', scope: 'you', session, agent: 'claude-code' });
  const session = ulid(now());
  await record.append(as('hook', session), { v: 3, id: ulid(now()), kind: 'session.start', ts: now(), seq: `${now()}000000`, data: { agent: 'claude-code', worktree: repo, branch: null, thread: 'thread-1', billing: {}, loads: [] } });
  const invalid: { claim: string; reason: string }[] = [];
  const tasks = new AskTasks({
    raw: (q, params) => record.raw(q, params), asks: () => { throw Error('no asks here'); }, now, plant: undefined, drafts, work: undefined,
    append: async (c, e) => { await record.append(c, e); }, connection: (s) => as('core', s), pin: async () => ({}),
    keep: async (bytes) => createHash('sha256').update(bytes).digest('hex'), run: async () => undefined, invalid: async (claim, _commit, reason) => { invalid.push({ claim, reason }); },
  });
  const task_ref = `session:${session}#0`;
  await tasks.opened({ session, agent: 'claude-code', cwd: repo, thread: 'thread-1', task_ref, text: ASK, prompt: ASK, at: now() });
  for (let i = 0; i < 50 && !(await record.raw("SELECT 1 FROM definitions WHERE state = 'locked'")).length; i++) await new Promise((r) => setTimeout(r, 20));
  change(repo);
  await tasks.claim(session, 'claude-code', repo);
  const [claim] = (await record.raw("SELECT id FROM events WHERE kind = 'claim.made'")) as { id: string }[];
  await record.close();
  return { claim: `claim:${claim!.id}`, invalid };
}

describe('the floor at a claim', () => {
  it('a check file changed after the lock makes the claim INVALID, naming the file', async () => {
    const { claim, invalid } = await claimAfter((repo) => writeFileSync(join(repo, CHECK), '#!/bin/sh\nexit 0\n'));
    expect(invalid, 'one INVALID, on this claim').toHaveLength(1);
    expect(invalid[0]!.claim).toBe(claim);
    expect(invalid[0]!.reason).toContain(CHECK);
  });
  it('an unchanged definition records no verdict at the claim', async () => {
    const { invalid } = await claimAfter(() => undefined);
    expect(invalid).toEqual([]);
  });
});

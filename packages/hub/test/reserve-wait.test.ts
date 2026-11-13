// A definition held at your reserve (#322): the session is told once that it waits, however many window reports
// come while the window stays at the reserve, and it locks on the first report that shows the window clear. Real
// record and git repo; the definition locked through the kernel's own path.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord, ulid, type Connection } from '@deepbuild/record';
import { AskTasks } from '../src/ask-tasks.js';
import { renamedSince } from '@deepbuild/workspaces';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const ASK = 'make the receipt show the rounded total';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

describe('a definition held at your reserve', () => {
  it('is reported once while the window stays at the reserve, and locks once the window clears', async () => {
    dir = mkdtempSync(join(tmpdir(), 'reserve-'));
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'README.md'), 'x\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const drafts = join(dir, 'drafts.json');
    writeFileSync(drafts, JSON.stringify({ drafts: [{ ask: ASK, requirements: [{ id: 'R1', text: 'the receipt shows $18.01', source_line: 'ask', refuted_by: 'x', check: null, depth: 'unit', oracle: 'code' }], deliverables: [], budget: null }] }));
    let t = 1_760_000_000_000;
    const now = () => (t += 1000);
    const record = await openRecord({ path: join(dir, 'record.db'), now });
    const as = (writer: string, session: string): Connection => ({ writer, actor: 'you', scope: 'you', session, agent: 'claude-code' });
    const session = ulid(now());
    await record.append(as('hook', session), { v: 3, id: ulid(now()), kind: 'session.start', ts: now(), seq: `${now()}000000`, data: { agent: 'claude-code', worktree: repo, branch: null, thread: 'thread-1', billing: {}, loads: [] } });
    let why: string | undefined = 'plan window: acct@example.test\'s five-hour window is 97% used, at your 5% reserve';
    const readings: string[] = [];
    const tasks = new AskTasks({
      raw: (q, params) => record.raw(q, params), asks: () => { throw Error('no asks here'); }, now, plant: undefined, drafts, work: undefined, renamedSince,
      append: async (c, e) => { await record.append(c, e); }, connection: (s) => as('core', s), pin: async () => ({}),
      keep: async (bytes) => createHash('sha256').update(bytes).digest('hex'), run: async () => undefined, invalid: async () => undefined, unresolved: () => undefined,
      // A repo, never a workspace (#67): it lands nowhere, so the workspace calls answer as they do outside one.
      spaces: { land: async () => undefined, fill: async () => undefined, pin: async () => undefined, keep: async () => false, claimState: async () => undefined, folderOf: () => undefined },
      reading: async (_s, _a, text) => { readings.push(text); }, atReserve: () => why,
    });
    const task_ref = `session:${session}#0`;
    await tasks.opened({ session, agent: 'claude-code', cwd: repo, thread: 'thread-1', task_ref, text: ASK, prompt: ASK, at: now() });
    const settle = () => new Promise((r) => setTimeout(r, 50));
    await settle();
    expect(readings, 'one reading: the definition waits at the reserve').toHaveLength(1);
    expect(readings[0]).toContain('held at your reserve');
    // Three window reports while the window stays at the reserve: nothing new to say.
    for (let i = 0; i < 3; i++) { tasks.windowChanged(); await settle(); }
    expect(readings, 'still the one reading').toHaveLength(1);
    expect(await record.raw("SELECT 1 FROM definitions WHERE state = 'locked'")).toHaveLength(0);
    // The window clears: the lock lands.
    why = undefined;
    tasks.windowChanged();
    for (let i = 0; i < 50 && !(await record.raw("SELECT 1 FROM definitions WHERE state = 'locked'")).length; i++) await settle();
    expect(await record.raw("SELECT 1 FROM definitions WHERE state = 'locked'"), 'locked once the window cleared').toHaveLength(1);
    await record.close();
  });
});

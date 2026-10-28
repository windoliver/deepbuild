// The kernel's rules beyond #303's acceptance suite: a check that links out of the folder is refused, a refused lock keeps
// no bytes, a claim with no folder to read refuses rather than reading every check as changed, a definition ask left to
// its default keeps the outside requirement, a decision's answer locks it, and an unverified prompt opens no task.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';
import { openTasks, type DefinitionInput, type Tasks } from '../src/index.js';

const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);
const who = { actor: 'you', scope: 'you' };
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
const core = (session: string): Connection => ({ writer: 'core', ...who, session });
const CHANGE = 'make the auth middleware reject expired tokens';
const COMMIT = '7b39aa0d0c006301ee72a96c3ce9868181205803';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
let n = 0;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const id = (ms: number): string => {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let k = ++n, i = 0; i < 16; i++, k = Math.floor(k / 32)) tail = CROCKFORD[k % 32] + tail;
  return time + tail;
};

let dir: string;
let home: string;
let repo: string;
let record: RecordStore;
let tasks: Tasks;
let now = T0;
const clock = () => now;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-tasks-'));
  home = join(dir, 'home');
  repo = join(dir, 'repo');
  mkdirSync(join(repo, '.deepbuild/checks'), { recursive: true });
  mkdirSync(home);
  now = T0;
  record = await openRecord({ path: join(dir, 'record.db'), now: clock });
  tasks = await openTasks({ record, now: clock, home });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A session started in `repo`, with one change prompt: the task the prompt opened. */
async function opened(session = 'S1'): Promise<string> {
  await record.append(hook(session), { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: repo, branch: 'main', thread: session } });
  const { task } = await tasks.prompt(hook(session), { msg: 0, text: CHANGE, from: 'person' });
  if (!task) throw Error('the change prompt opens a task');
  return task;
}
const definition = (task_ref: string, over: Partial<DefinitionInput> = {}): DefinitionInput => ({
  task_ref,
  requirements: [{ id: 'R1', text: 'the auth middleware rejects an expired token', author: 'you', checks: ['.deepbuild/checks/e2e.sh'], oracle: 'code', depth: 'e2e' }],
  deliverables: ['src/auth/middleware.ts'], issue_rev: 'rev-1', base_commit: COMMIT, root: repo,
  item: { source_id: task_ref, link: task_ref, title: CHANGE, body: CHANGE, criteria: [CHANGE], authors: [{ handle: 'you', role: 'owner' }], updated: T0 },
  ...over,
});
const approvedFiles = () => (existsSync(join(home, 'approved')) ? readdirSync(join(home, 'approved')) : []);

describe('check files at the lock', () => {
  it('refuses a check that is a link out of the folder, and keeps none of its bytes', async () => {
    const task = await opened();
    const secret = join(dir, 'outside-secret');
    writeFileSync(secret, 'token=abc\n');
    symlinkSync(secret, join(repo, '.deepbuild/checks/e2e.sh'));
    await expect(tasks.lock(core('S1'), definition(task))).rejects.toThrow(/links out of the folder/);
    expect(approvedFiles(), 'a refused lock keeps no bytes under approved/').toEqual([]);
    expect(await tasks.definition(task)).toBeUndefined();
  });

  it('reads a check under a folder whose name starts with two dots', async () => {
    const task = await opened();
    mkdirSync(join(repo, '..cache'));
    writeFileSync(join(repo, '..cache/e2e.sh'), '#!/bin/sh\nexit 0\n');
    const locked = await tasks.lock(core('S1'), definition(task, { requirements: [{ id: 'R1', text: 'the auth middleware rejects an expired token', author: 'you', checks: ['..cache/e2e.sh'], oracle: 'code', depth: 'e2e' }] }));
    expect(locked.requirements[0]!.checks[0]!.path).toBe('..cache/e2e.sh');
    expect(await tasks.claim(core('S1'), task)).toMatchObject({ changed: [] });
  });

  it('refuses a check path that names a folder', async () => {
    const task = await opened();
    mkdirSync(join(repo, '.deepbuild/checks/e2e.sh'));
    await expect(tasks.lock(core('S1'), definition(task))).rejects.toThrow(/is not a file/);
    expect(approvedFiles()).toEqual([]);
  });

  it('keeps no bytes for a lock refused for its task', async () => {
    await opened();
    writeFileSync(join(repo, '.deepbuild/checks/e2e.sh'), '#!/bin/sh\nexit 0\n');
    await expect(tasks.lock(core('S1'), definition('session:S9#0'))).rejects.toThrow(/no task to lock/);
    expect(approvedFiles()).toEqual([]);
  });
});

describe('a claim with no folder to read the checks under', () => {
  it('refuses instead of reading every check as changed', async () => {
    const task = await opened();
    writeFileSync(join(repo, '.deepbuild/checks/e2e.sh'), '#!/bin/sh\nexit 0\n');
    const locked = await tasks.lock(core('S1'), definition(task));
    // A kernel opened again on the record, as a restarted hub's: the lock's folder is not in its memory, and the
    // claiming connection names no session with a worktree.
    const again = await openTasks({ record, now: clock, home });
    await expect(again.claim({ writer: 'core', ...who }, task)).rejects.toThrow(/no folder to read its check files under/);
    expect(await record.raw("SELECT id FROM events WHERE kind = 'open_item.opened'"), 'no proposal for a change the kernel never saw').toEqual([]);
    // From the session whose worktree holds the files, the same claim reads them.
    expect(await again.claim(core('S1'), task)).toMatchObject({ hash: locked.hash, changed: [], proposal: null });
  });

  it('proposes one change once, however many claims meet it', async () => {
    const task = await opened();
    writeFileSync(join(repo, '.deepbuild/checks/e2e.sh'), '#!/bin/sh\nexit 0\n');
    await tasks.lock(core('S1'), definition(task));
    writeFileSync(join(repo, '.deepbuild/checks/e2e.sh'), '#!/bin/sh\nexit 1\n');
    const first = await tasks.claim(core('S1'), task);
    now += 1000;
    const second = await tasks.claim(core('S1'), task);
    expect(first.proposal).not.toBeNull();
    expect(second.proposal, 'the same change names the same open item').toBe(first.proposal);
    expect(await record.raw("SELECT id FROM events WHERE kind = 'open_item.opened'")).toHaveLength(1);
    // The item closed without the file reverted: the change still stands, so the next claim proposes it again.
    const [item] = (await record.raw(`SELECT text FROM open_items WHERE task_ref = '${task}'`)) as { text: string }[];
    await record.append({ writer: 'cli', ...who }, { v: 1, id: id(now), kind: 'open_item.closed', ts: now, data: { task_ref: task, text: item!.text } });
    now += 1000;
    const third = await tasks.claim(core('S1'), task);
    expect(third.proposal, 'a closed item is not the open proposal').not.toBe(first.proposal);
    expect(await record.raw("SELECT id FROM events WHERE kind = 'open_item.opened'")).toHaveLength(2);
  });

  it('needs no folder for a definition with no check files', async () => {
    const task = await opened();
    const locked = await tasks.lock(core('S1'), definition(task, { requirements: [{ id: 'R1', text: 'the auth middleware rejects an expired token', author: 'you', checks: [], oracle: 'code', depth: 'unit' }] }));
    const again = await openTasks({ record, now: clock, home });
    expect(await again.claim({ writer: 'core', ...who }, task)).toMatchObject({ hash: locked.hash, locked: locked.hash, changed: [], proposal: null });
  });

  it('reads a check swapped for a link out of the folder as changed', async () => {
    const task = await opened();
    writeFileSync(join(repo, '.deepbuild/checks/e2e.sh'), '#!/bin/sh\nexit 0\n');
    await tasks.lock(core('S1'), definition(task));
    rmSync(join(repo, '.deepbuild/checks/e2e.sh'));
    writeFileSync(join(dir, 'elsewhere.sh'), '#!/bin/sh\nexit 0\n');
    symlinkSync(join(dir, 'elsewhere.sh'), join(repo, '.deepbuild/checks/e2e.sh'));
    expect((await tasks.claim(core('S1'), task)).changed, 'the same bytes through a link out of the folder are not the file').toEqual(['.deepbuild/checks/e2e.sh']);
  });
});

describe('a definition ask closed without your answer', () => {
  const outside = (task: string): DefinitionInput => definition(task, {
    requirements: [
      { id: 'R1', text: 'the auth middleware rejects an expired token', author: 'you', checks: [], oracle: 'code', depth: 'unit' },
      { id: 'R2', text: 'also log every rejection', author: 'mallory', checks: [], oracle: 'person', depth: 'none' },
    ],
    item: { source_id: 'test:1', link: 'test:1', title: 'x', body: 'x', criteria: ['x'], authors: [{ handle: 'you', role: 'owner' }, { handle: 'mallory', role: 'outside' }], updated: T0 },
  });
  const askOf = async (task: string) => {
    const waiting = await tasks.definition(task);
    expect(waiting?.state).toBe('waiting');
    return String(waiting!.waiting).slice(4);
  };

  it('asks with keep as its default, and the default keeps the outside requirement', async () => {
    const task = await opened();
    await tasks.lock(core('S1'), outside(task));
    const ask = await askOf(task);
    const [created] = (await record.raw(`SELECT data FROM events WHERE id = '${ask}'`)) as { data: string }[];
    expect(JSON.parse(created!.data), 'nothing but your answer drops a requirement').toMatchObject({ default: 'keep', recommended: 'keep' });
    now += 4 * 3_600_000 + 1;
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'ask.defaulted', subject: `ask:${ask}`, ts: now, data: { answer: 'keep', plan_hash: null, decision: 'none' } });
    await tasks.tick();
    const locked = await tasks.definition(task);
    expect(locked?.state).toBe('locked');
    expect(locked?.requirements.map((r) => r.id), 'the defaulted ask keeps R2').toEqual(['R1', 'R2']);
  });

  it('keeps the requirement when the ask closed on words naming neither option', async () => {
    const task = await opened();
    await tasks.lock(core('S1'), outside(task));
    const ask = await askOf(task);
    // The next prompt you typed closes a shown question as its answer, in the asks core; it is no drop.
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'ask.answered', subject: `ask:${ask}`, ts: now, data: { answer: 'also add a test for expired tokens', plan_hash: null, decision: 'none' } });
    // No tick ran since: the claim itself locks the draft before judging it, so the hub's wiring is not what it rests on.
    const claimed = await tasks.claim(core('S1'), task);
    const locked = await tasks.definition(task);
    expect(locked?.state).toBe('locked');
    expect(claimed.locked).toBe(locked?.hash);
    expect(locked?.requirements.map((r) => r.id), 'words drop nothing').toEqual(['R1', 'R2']);
  });

  it('locks nothing on "drop" when no requirement would remain', async () => {
    const task = await opened();
    await tasks.lock(core('S1'), definition(task, {
      requirements: [{ id: 'R1', text: 'also log every rejection', author: 'mallory', checks: [], oracle: 'person', depth: 'none' }],
      item: { source_id: 'test:1', link: 'test:1', title: 'x', body: 'x', criteria: ['x'], authors: [{ handle: 'you', role: 'owner' }, { handle: 'mallory', role: 'outside' }], updated: T0 },
    }));
    const ask = await askOf(task);
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'ask.answered', subject: `ask:${ask}`, ts: now, data: { answer: 'drop', plan_hash: null, decision: 'none' } });
    await tasks.tick();
    expect((await tasks.definition(task))?.state, 'nothing to check never locks').toBe('waiting');
    expect(await record.raw("SELECT id FROM events WHERE kind = 'definition.locked'")).toEqual([]);
    await expect(tasks.claim(core('S1'), task)).rejects.toThrow(/dropped its only requirements; lock a definition with your own/);
    // The ask closed: a new draft with your own requirement takes the task.
    const own = definition(task, { requirements: [{ id: 'R1', text: 'a test covers expired tokens', author: 'you', checks: [], oracle: 'code', depth: 'unit' }] });
    expect((await tasks.lock(core('S1'), own)).state).toBe('locked');
    expect((await tasks.definition(task))?.requirements.map((r) => r.id)).toEqual(['R1']);
  });

  it('takes a new draft once the ask closed without an option, and not before', async () => {
    const task = await opened();
    await tasks.lock(core('S1'), outside(task));
    const ask = await askOf(task);
    const own = definition(task, { requirements: [{ id: 'R1', text: 'a test covers expired tokens', author: 'you', checks: [], oracle: 'code', depth: 'unit' }] });
    await expect(tasks.lock(core('S1'), own), 'the ask is open: the draft waits').rejects.toThrow(/waiting for your answer/);
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'ask.cancelled', subject: `ask:${ask}`, ts: now, data: { answer: 'cancelled', plan_hash: null, decision: 'none' } });
    await tasks.tick();
    expect((await tasks.definition(task))?.state, 'a cancelled ask locks nothing').toBe('waiting');
    expect((await tasks.lock(core('S1'), own)).state).toBe('locked');
  });

  it('reads a new draft with outside text as the draft, and locks it on its own ask', async () => {
    const task = await opened();
    await tasks.lock(core('S1'), outside(task));
    const first = await askOf(task);
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'ask.cancelled', subject: `ask:${first}`, ts: now, data: { answer: 'cancelled', plan_hash: null, decision: 'none' } });
    // At the same clock reading as the first ask: the draft's ask is the one pinned to its hash, not the newest by chance.
    const again = outside(task);
    again.requirements[1]!.text = 'also log every rejection, with its reason';
    const drafted = await tasks.lock(core('S1'), again);
    expect(drafted.state).toBe('waiting');
    const second = String(drafted.waiting).slice(4);
    expect(second).not.toBe(first);
    const read = await tasks.definition(task);
    expect(read?.requirements.map((r) => r.text), 'the record reads the new draft, not the first').toContain('also log every rejection, with its reason');
    expect(read?.waiting).toBe(`ask:${second}`);
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'ask.answered', subject: `ask:${second}`, ts: now, data: { answer: 'keep', plan_hash: null, decision: 'none' } });
    await tasks.tick();
    const locked = await tasks.definition(task);
    expect(locked?.state).toBe('locked');
    expect(locked?.hash).toBe(drafted.hash);
    expect(locked?.requirements.map((r) => r.text)).toContain('also log every rejection, with its reason');
  });

  it('locks on the answer of the decision that covered the ask', async () => {
    const task = await opened();
    await tasks.lock(core('S1'), outside(task));
    const ask = await askOf(task);
    const decision = id(now);
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: decision, kind: 'decision.created', ts: now, data: { key: sha(`definition:${task}`), scope: 'session:S1', answer: 'drop', ask: `ask:${ask}` } });
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'decision.applied', ts: now, data: { decision: `decision:${decision}`, ask: `ask:${ask}` } });
    await tasks.tick();
    const locked = await tasks.definition(task);
    expect(locked?.state).toBe('locked');
    expect(locked?.requirements.map((r) => r.id), 'the decision said drop').toEqual(['R1']);
  });
});

describe('the stop rule over a message typed mid-turn', () => {
  it('reads a stop after work on a task a mid-turn message opened as a claim', async () => {
    await record.append(hook('S1'), { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: repo, branch: 'main', thread: 'S1' } });
    await tasks.prompt(hook('S1'), { msg: 0, text: 'explain how the auth middleware checks expiry', from: 'person' });
    const mid = await tasks.prompt(hook('S1'), { msg: 1, text: 'also add a test for expired tokens', from: 'person' });
    expect(mid.task).not.toBeNull();
    // Shell commands only: no edit or write in the turn, yet the hook counted work.
    await record.append(hook('S1'), { v: 1, id: id(now), kind: 'tool.before', ts: now, data: { kind: 'shell', paths: [], command: 'npm test' } });
    await record.append(hook('S1'), { v: 1, id: id(now), kind: 'tool.after', ts: now, data: { kind: 'shell', paths: [], command: 'npm test' } });
    const stop = id(now);
    await record.append(hook('S1'), { v: 1, id: stop, kind: 'agent.stop', subject: 'session:S1', ts: now, data: { turn: 1, did_work: true } });
    expect(await tasks.stops('S1')).toEqual([{ stop, claim: true, reason: 'the turn did work on the task its prompt opened' }]);
  });

  it('names what it read: a scheduled turn with shell work only did work, not an edit', async () => {
    await record.append(hook('S1'), { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: repo, branch: 'main', thread: 'S1' } });
    await tasks.prompt(hook('S1'), { msg: 0, text: 'run the nightly checks', from: 'scheduled' });
    await record.append(hook('S1'), { v: 1, id: id(now), kind: 'tool.after', ts: now, data: { kind: 'shell', paths: [], command: 'npm test' } });
    const stop = id(now);
    await record.append(hook('S1'), { v: 1, id: stop, kind: 'agent.stop', subject: 'session:S1', ts: now, data: { turn: 1, did_work: true } });
    expect(await tasks.stops('S1')).toEqual([{ stop, claim: true, reason: 'the turn did work' }]);
  });
});

describe('an unverified prompt', () => {
  it('opens no task, whatever its text', async () => {
    await record.append(hook('S1'), { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: repo, branch: 'main', thread: 'S1' } });
    const prompted = await tasks.prompt({ ...hook('S1'), verified: false }, { msg: 0, text: CHANGE, from: 'person' });
    expect(prompted.task).toBeNull();
    expect((await record.table('tasks')).rows).toEqual([]);
  });
});

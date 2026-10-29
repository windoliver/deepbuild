// Ask-tasks hardening (#303 follow-up): a definition locks only on check files the session's folder really holds, a
// replayed prompt opens its task once, and a definition that your answer would empty locks nothing; the undo of a
// definition ask's default is refused once the definition locked on it.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub, type Hub } from './hub.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '7a2b3c4d-3333-4333-8444-555566667777';
const HANDLE = `session:${SESSION.replace(/[^0-9A-Za-z]/g, '')}`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

type Obj = Record<string, unknown>;
/** A requirement of a handed definition, in the issue's fields. */
const req = (id: string, text: string, o: Obj = {}): Obj => ({ id, text, source_line: 'ask#L1', refuted_by: `a run where ${text} does not hold`, check: null, on_base: 'fails', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...o });
const draft = (ask: string, requirements: Obj[]) => ({ ask, requirements, deliverables: ['src/auth.ts'], budget: null });
/** Your ask settings, with a definition ask defaulting after one minute, the shortest the settings take. */
const SETTINGS = { deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '1m' }, default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' }, fallback: ['change-owner'], fold: 5 };

/** A world under the hub's home: a git repository the session works in, its transcript where Claude Code keeps it, the handed drafts and readings. */
function world(home: string, drafts: Obj[], readings: Obj[] = []) {
  const work = join(home, 'work');
  mkdirSync(join(work, '.deepbuild', 'checks'), { recursive: true });
  writeFileSync(join(work, '.deepbuild', 'checks', 'ok.sh'), '#!/bin/sh\nexit 1\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' } });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(projects, { recursive: true });
  const transcript = join(projects, `${SESSION}.jsonl`);
  writeFileSync(transcript, '');
  writeFileSync(join(home, 'drafts.json'), JSON.stringify({ drafts }));
  writeFileSync(join(home, 'work.json'), JSON.stringify({ readings }));
  writeFileSync(join(home, 'confirm'), 'confirmed\n');
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  writeFileSync(join(home, '.deepbuild', 'config.json'), JSON.stringify({ asks: SETTINGS }));
  return { work, transcript, env: { DEEP_HUB_TEST_DRAFTS: join(home, 'drafts.json'), DEEP_HUB_TEST_WORK: join(home, 'work.json'), DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') } };
}

/** A session's hooks against a hub: the typed prompt's transcript entry (as Claude Code writes it) and its UserPromptSubmit. */
function session(root: string, w: { work: string; transcript: string }, claude: ChildProcess) {
  let msg = 0;
  const entry = (line: object) => appendFileSync(w.transcript, `${JSON.stringify({ ...line, origin: { kind: 'human' }, turnOrigin: 'human', uuid: ulid(Date.now()), timestamp: new Date().toISOString(), isSidechain: false, sessionId: SESSION, cwd: w.work })}\n`);
  const line = (event: string, extra: Record<string, unknown> = {}) => hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: w.transcript, cwd: w.work, hook_event_name: event, ...extra }, { ppid: claude.pid });
  const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), line(event, extra));
  const typed = async (text: string) => {
    const id = `p${msg}`;
    entry({ type: 'user', promptId: id, message: { role: 'user', content: text } });
    const l = line('UserPromptSubmit', { prompt: text, prompt_id: id });
    msg += 1;
    await send(join(root, 'hub.sock'), l);
    return l;
  };
  return { hook, typed, handle: (n: number) => `${HANDLE}#${String(n)}` };
}

function ledger(root: string) {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  const events = (kind: string) => (db.prepare('SELECT id, data FROM events WHERE kind = ? AND session_id = ? ORDER BY log_pos').all(kind, SESSION) as { id: string; data: string }[]).map((r) => ({ ...(JSON.parse(r.data) as Obj), id: r.id }) as Obj & { id: string });
  const settle = async (ready: () => boolean, ms = 20_000) => { for (const until = Date.now() + ms; Date.now() < until && !ready(); await new Promise((r) => setTimeout(r, 100))); };
  const locked = (task: string) => events('definition.locked').filter((e) => e.task_ref === task);
  return { db, events, settle, locked };
}

const BAD = 'make the auth middleware reject expired tokens';
const FOLDER = 'add a rate limit to the login route';
const MISSING = 'fix the password reset email';
const ESCAPE = 'remove the legacy session cookie';
const GOOD = 'support refresh tokens';

describe('ask-tasks hardening', () => {
  it('locks a definition only on check files the folder holds: a link out of it, a folder, a missing file and a path out of it refuse the lock, and the lock on a real file carries its bytes\' digest', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home, hub: Hub) => {
      const w = world(home, [
        draft(BAD, [req('R1', 'expired tokens are rejected', { check: '.deepbuild/checks/link.sh' })]),
        draft(FOLDER, [req('R1', 'five attempts a minute', { check: '.deepbuild/checks' })]),
        draft(MISSING, [req('R1', 'the email is sent', { check: '.deepbuild/checks/missing.sh' })]),
        draft(ESCAPE, [req('R1', 'the cookie is gone', { check: '../outside.sh' })]),
        draft(GOOD, [req('R1', 'a refresh token is accepted', { check: '.deepbuild/checks/ok.sh' })]),
      ]);
      writeFileSync(join(home, 'outside.sh'), '#!/bin/sh\nexit 0\n');
      symlinkSync(join(home, 'outside.sh'), join(w.work, '.deepbuild', 'checks', 'link.sh'));
      await hub.restart(w.env);
      const s = session(root, w, claude);
      const l = ledger(root);
      try {
        await s.hook('SessionStart', { source: 'startup' });
        await l.settle(() => l.events('session.start').length > 0);
        for (const text of [BAD, FOLDER, MISSING, ESCAPE, GOOD]) await s.typed(text);
        await l.settle(() => l.events('task.created').length === 5);
        await l.settle(() => l.locked(s.handle(4)).length > 0);
        // The refused locks were started before the one that landed; a moment more for any that would still land.
        await new Promise((r) => setTimeout(r, 1500));
        const [good] = l.locked(s.handle(4));
        expect((good!.requirements as Obj[])[0], 'the lock on a file the folder holds carries the digest of its bytes').toMatchObject({ check: '.deepbuild/checks/ok.sh', check_sha256: sha('#!/bin/sh\nexit 1\n') });
        for (const [n, what] of [[0, 'a link out of the folder'], [1, 'a folder'], [2, 'a file that is not there'], [3, 'a path out of the folder']] as const) {
          expect(l.locked(s.handle(n)), `${what} as a check refuses the lock: no definition.locked for ${s.handle(n)}`).toEqual([]);
        }
        expect(l.events('task.created').map((e) => e.task_ref), 'each prompt still opened its task').toEqual([0, 1, 2, 3, 4].map(s.handle));
      } finally {
        l.db.close();
      }
    });
  }, 90_000);

  it('a replayed prompt hook opens its task once and locks its definition once', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home, hub: Hub) => {
      const w = world(home, [draft(GOOD, [req('R1', 'a refresh token is accepted', { check: '.deepbuild/checks/ok.sh' })])]);
      await hub.restart(w.env);
      const s = session(root, w, claude);
      const l = ledger(root);
      try {
        await s.hook('SessionStart', { source: 'startup' });
        await l.settle(() => l.events('session.start').length > 0);
        const line = await s.typed(GOOD);
        await l.settle(() => l.locked(s.handle(0)).length > 0);
        // The same hook again, as a spool replayed after a hub restart sends it.
        await send(join(root, 'hub.sock'), line);
        await send(join(root, 'hub.sock'), line);
        await s.hook('Stop', {});
        await l.settle(() => l.events('agent.stop').length > 0);
        expect(l.events('user.ask').length, 'the prompt is recorded once').toBe(1);
        expect(l.events('task.created').map((e) => e.task_ref), 'the task is opened once').toEqual([s.handle(0)]);
        expect(l.locked(s.handle(0)).length, 'the definition is locked once').toBe(1);
      } finally {
        l.db.close();
      }
    });
  }, 90_000);

  it('a definition that leaving the outside text out would empty locks nothing, and the undo of the default a definition locked on is refused', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home, hub: Hub) => {
      // A source line from a reading the work source doesn't hold is an unknown author, outside the repo.
      const w = world(home, [
        // Only outside text: leaving it out leaves nothing to lock.
        draft(FOLDER, [req('R1', 'five attempts a minute', { source_line: 'item-9#L1' })]),
        // Your own requirement and an outside one: leaving the outside one out locks R1 alone.
        draft(GOOD, [req('R1', 'a refresh token is accepted'), req('R2', 'each refresh is logged', { source_line: 'item-9#L1' })]),
      ]);
      await hub.restart(w.env);
      const s = session(root, w, claude);
      const l = ledger(root);
      try {
        await s.hook('SessionStart', { source: 'startup' });
        await l.settle(() => l.events('session.start').length > 0);
        await s.typed(FOLDER);
        await s.typed(GOOD);
        await l.settle(() => l.events('ask.created').filter((e) => e.kind === 'definition').length === 2);
        const asks = l.events('ask.created').filter((e) => e.kind === 'definition');
        expect(l.locked(s.handle(0)).concat(l.locked(s.handle(1))), 'both definitions wait for your answer').toEqual([]);
        // At the deadline each takes the default, leave-out.
        await l.settle(() => l.events('ask.defaulted').length === 2, 150_000);
        await l.settle(() => l.locked(s.handle(1)).length > 0);
        const [lock] = l.locked(s.handle(1));
        expect((lock!.requirements as Obj[]).map((r) => r.id), 'the definition with your own requirement locks on it alone').toEqual(['R1']);
        await new Promise((r) => setTimeout(r, 1500));
        expect(l.locked(s.handle(0)), 'a definition the default empties locks nothing').toEqual([]);

        const lockedOn = asks.find((a) => String(a.question).includes(s.handle(1)));
        expect(lockedOn, 'the ask about the definition that locked').toBeDefined();
        const undo = spawnSync(process.execPath, [CLI, 'inbox', 'undo', `ask:${lockedOn!.id}`], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000 });
        expect(undo.status, `the undo of a default a definition locked on is refused: ${undo.stdout}${undo.stderr}`).toBe(1);
        expect(undo.stderr, 'the refusal names the definition that locked on it').toMatch(new RegExp(`definition of ${s.handle(1).replace('#', '\\#')} locked on it`));
        expect(l.events('ask.defaulted').length, 'the ask stays defaulted').toBe(2);

        // The emptied one's default can be undone, and your answer then locks the definition with the outside text in.
        const emptied = asks.find((a) => String(a.question).includes(s.handle(0)));
        expect(emptied, 'the ask about the definition the default emptied').toBeDefined();
        const reopen = spawnSync(process.execPath, [CLI, 'inbox', 'undo', `ask:${emptied!.id}`], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000 });
        expect(reopen.status, `the undo of a default that locked nothing counts: ${reopen.stdout}${reopen.stderr}`).toBe(0);
        const keep = spawnSync(process.execPath, [CLI, 'inbox', 'answer', `ask:${emptied!.id}`, 'keep'], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000 });
        expect(keep.status, `your answer keep counts: ${keep.stdout}${keep.stderr}`).toBe(0);
        await l.settle(() => l.locked(s.handle(0)).length > 0);
        expect((l.locked(s.handle(0))[0]?.requirements as Obj[] | undefined)?.map((r) => r.id), 'the definition locks with the outside requirement in, after the undo').toEqual(['R1']);
      } finally {
        l.db.close();
      }
    });
  }, 240_000);
});

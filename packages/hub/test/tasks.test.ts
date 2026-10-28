// Ask-tasks at the prompt hook (#303): the hub records each prompt through the kernel, so only a prompt a person typed
// that asks for new or changed behavior opens a task, keyed by its message handle, in the same hook; a question records
// `tasks: []` and opens nothing.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '7a2b3c4d-2222-4333-8444-555566667777';
const HANDLE = `session:${SESSION.replace(/[^0-9A-Za-z]/g, '')}`;

describe('ask-tasks at the prompt hook', () => {
  it('records a question with tasks: [] and no task, and a prompt asking for a change with its task, in the same hook', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      // A typed prompt's transcript entry, as Claude Code writes it: the adapter places the prompt by its promptId and reads `person` off turnOrigin.
      const entry = (line: object) => appendFileSync(transcript, `${JSON.stringify({ ...line, origin: { kind: 'human' }, turnOrigin: 'human', uuid: ulid(Date.now()), timestamp: new Date().toISOString(), isSidechain: false, sessionId: SESSION, cwd: work })}\n`);
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid: claude.pid }));

      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const rows = (kind: string) => (db.prepare('SELECT data FROM events WHERE kind = ? AND session_id = ? ORDER BY log_pos').all(kind, SESSION) as { data: string }[]).map((r) => JSON.parse(r.data) as Record<string, unknown>);
      const settle = async (kind: string, n: number) => { for (const until = Date.now() + 10_000; Date.now() < until && rows(kind).length < n; await new Promise((r) => setTimeout(r, 50))); return rows(kind); };
      try {
        await hook('SessionStart', { source: 'startup' });
        await settle('session.start', 1);
        entry({ type: 'user', promptId: 'p1', message: { role: 'user', content: 'explain how the auth middleware checks expiry' } });
        await hook('UserPromptSubmit', { prompt: 'explain how the auth middleware checks expiry', prompt_id: 'p1' });
        const [question] = await settle('user.ask', 1);
        expect(question, 'a question you typed is recorded as yours and opens no task').toMatchObject({ from: 'person', tasks: [], msg: 0 });
        await hook('Stop', {});
        await settle('agent.stop', 1);
        expect(rows('task.created'), 'no task for the question').toEqual([]);

        entry({ type: 'user', promptId: 'p2', message: { role: 'user', content: 'make the auth middleware reject expired tokens' } });
        await hook('UserPromptSubmit', { prompt: 'make the auth middleware reject expired tokens', prompt_id: 'p2' });
        const asks = await settle('user.ask', 2);
        expect(asks[1], 'a prompt asking for a change names the task it opened: its message handle').toMatchObject({ from: 'person', tasks: [`${HANDLE}#1`], msg: 1 });
        const [task] = await settle('task.created', 1);
        expect(task, 'the task sits under the session\'s thread, in the same hook').toMatchObject({ task_ref: `${HANDLE}#1`, thread: SESSION, owner: 'you' });
        const row = db.prepare('SELECT task_ref, thread, state FROM tasks WHERE task_ref = ?').get(`${HANDLE}#1`) as Record<string, unknown> | undefined;
        expect(row, 'the tasks projection holds it').toMatchObject({ task_ref: `${HANDLE}#1`, thread: SESSION, state: 'queued' });
      } finally {
        db.close();
      }
    });
  }, 60_000);
});

// Messages you type while the agent works (#25): the Claude desktop app queues one in the transcript and fires no
// hook for it until the call ends (#80), so the hub reads it from the transcript's queue at the session's next hook
// and records it as a prompt you typed, once, whichever of the queue and its UserPromptSubmit shows it first.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, reply, send, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '4f1c2d3e-1111-4222-8333-444455556666';
const queued = (content: string) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: SESSION, content });

describe('messages typed while the agent works', () => {
  it('records a queued message as your prompt at the next hook, once, whether the queue or its UserPromptSubmit shows it first', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      // The session's transcript where Claude Code keeps it (facts: transcripts.path), so its hooks check against it.
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const entry = (line: object) => appendFileSync(transcript, `${JSON.stringify(line)}\n`);
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid: claude.pid }));
      const call = (id: string) => ({ tool_name: 'Bash', tool_input: { command: 'sleep 60' }, tool_use_id: id });

      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const count = (kind: string) => (db.prepare('SELECT count(*) AS n FROM events WHERE kind = ? AND session_id = ?').get(kind, SESSION) as { n: number }).n;
      await hook('SessionStart', { source: 'startup' });
      // The hub reads a session's transcript from where it met it, so its start is in before any entry is written.
      for (const until = Date.now() + 10_000; Date.now() < until && !count('session.start'); await new Promise((r) => setTimeout(r, 50)));
      entry({ type: 'user', promptId: 'p1', sessionId: SESSION, message: { role: 'user', content: 'Fix the header test.' } });
      await hook('UserPromptSubmit', { prompt: 'Fix the header test.', prompt_id: 'p1' });
      await hook('PreToolUse', call('toolu_1'));
      // The desktop app: typed while the call runs, queued, no hook; the call's PostToolUse is the next hook.
      entry(queued('Also make the footer green.'));
      await hook('PostToolUse', call('toolu_1'));
      const asks = () => (db.prepare("SELECT data FROM events WHERE kind = 'user.ask' AND session_id = ? ORDER BY log_pos").all(SESSION) as { data: string }[]).map((r) => JSON.parse(r.data) as { text: string; from: string });
      const read = async (n: number) => { for (const until = Date.now() + 10_000; Date.now() < until && asks().length < n; await new Promise((r) => setTimeout(r, 50))); return asks(); };
      const early = await read(2);
      expect(early.map((a) => a.text), 'the queued message is recorded at the hook after it was typed, before any prompt hook fires for it').toEqual(['Fix the header test.', 'Also make the footer green.']);
      expect(early[1]!.from, 'a message read from the queue is a prompt you typed').toBe('person');
      // Dequeued later, it fires its UserPromptSubmit: already recorded, it isn't recorded again.
      entry({ type: 'user', promptId: 'p2', sessionId: SESSION, message: { role: 'user', content: 'Also make the footer green.' } });
      await hook('UserPromptSubmit', { prompt: 'Also make the footer green.', prompt_id: 'p2' });
      // The terminal: the prompt fires its UserPromptSubmit at once and is queued too; the queue doesn't record it again.
      await hook('PreToolUse', call('toolu_2'));
      await hook('UserPromptSubmit', { prompt: 'And the sidebar.', prompt_id: 'p3' });
      entry(queued('And the sidebar.'));
      await hook('PostToolUse', call('toolu_2'));
      // A wake the waiter queued is not your message.
      entry(queued('<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>'));
      await hook('Stop', {});

      try {
        await read(3);
        await new Promise((r) => setTimeout(r, 500));
        expect(asks().map((a) => a.text), 'each message you typed is recorded once, whichever of the queue and its UserPromptSubmit showed it first').toEqual(['Fix the header test.', 'Also make the footer green.', 'And the sidebar.']);
      } finally {
        db.close();
      }
    });
  }, 60_000);
});

describe('a message typed while the agent works', () => {
  it('is acknowledged at a later call, never in place of a guard\'s block on the next one', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: { blocked: { match: 'kill:by-name', scope: 'all_repos', mode: 'block', reason: 'REASON.', next_step: 'NEXT.', fail_closed: false } } }));
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const socket = join(root, 'hub.sock');
      const entry = (line: object) => appendFileSync(transcript, `${JSON.stringify(line)}\n`);
      const payload = (event: string, extra: Record<string, unknown> = {}) => ({ session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(socket, hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: claude.pid }));
      const call = (id: string) => ({ tool_name: 'Bash', tool_input: { command: 'sleep 60' }, tool_use_id: id });
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const asks = () => (db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'user.ask' AND session_id = ?").get(SESSION) as { n: number }).n;
      try {
        await hook('SessionStart', { source: 'startup' });
        for (const until = Date.now() + 10_000; Date.now() < until && !(db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'session.start' AND session_id = ?").get(SESSION) as { n: number }).n; await new Promise((r) => setTimeout(r, 50)));
        entry({ type: 'user', promptId: 'p1', sessionId: SESSION, message: { role: 'user', content: 'Fix the header test.' } });
        await hook('UserPromptSubmit', { prompt: 'Fix the header test.', prompt_id: 'p1' });
        await hook('PreToolUse', call('toolu_1'));
        entry(queued('Also make the footer green.'));
        await hook('PostToolUse', call('toolu_1'));
        for (const until = Date.now() + 10_000; Date.now() < until && asks() < 2; await new Promise((r) => setTimeout(r, 50)));
        await new Promise((r) => setTimeout(r, 200));
        const denied = await reply(socket, hookLine(ulid(Date.now()), 'PreToolUse', payload('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pkill -f node' }, tool_use_id: 'toolu_2' }), { ppid: claude.pid, matched: ['blocked'], notes: {} }));
        expect(denied.exit, JSON.stringify(denied)).toBe(2);
      } finally { db.close(); }
    });
  }, 60_000);
});

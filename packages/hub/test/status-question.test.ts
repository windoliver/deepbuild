// A status question you type is answered from the record in the model's place (#83): after a hub restart the
// answer carries the state the session's row holds, since no hook of the session has told the core its state yet.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '5a2d3e4f-1111-4222-8333-444455556666';

/** Sends one hook the way deep-hook does and reads the hub's reply to it, the line after the acknowledgement. */
function reply(socket: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => { got += d; if (got.split('\n').length === 2) sock.write(line); });
    sock.on('end', () => resolve(got.split('\n')[2] ?? ''));
    sock.on('error', reject);
  });
}

describe('a status question after a hub restart', () => {
  it('answers with the state the session\'s row holds, not as if it were working', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home, { restart }) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const entry = (line: object) => appendFileSync(transcript, `${JSON.stringify(line)}\n`);
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: claude.pid }));
      const prompt = (text: string, id: string) => {
        entry({ type: 'user', promptId: id, sessionId: SESSION, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
        return reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'UserPromptSubmit', payload('UserPromptSubmit', { prompt: text, prompt_id: id }), { ppid: claude.pid }));
      };
      await hook('SessionStart', { source: 'startup' });
      await prompt('Fix the header test.', 'p1');
      // The agent asks to run a command: the session waits on you.
      await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -r dist' }, tool_use_id: 'toolu_1' });
      await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -r dist' }, tool_use_id: 'toolu_1' });
      await restart();
      const answer = await prompt('still going?', 'p2');
      // A core that knows a session's state only from its hooks since its start answers `working` for every session it meets at a status question.
      const shown = String((JSON.parse(answer) as { stdout: string }).stdout);
      expect(shown, "the question is answered in the model's place").toContain('"decision":"block"');
      expect(shown).toContain('waiting · next: you');
    });
  }, 60_000);
});

describe('a status question the transcript queue showed first', () => {
  it('is answered in the model\'s place at its own prompt hook, whose draft the queue\'s record took', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    const session = '6b3e4f5a-1111-4222-8333-444455556666';
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${session}.jsonl`);
      writeFileSync(transcript, '');
      const entry = (line: object) => appendFileSync(transcript, `${JSON.stringify(line)}\n`);
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: claude.pid }));
      const typed = (text: string, id: string) => entry({ type: 'user', promptId: id, sessionId: session, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
      const call = { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'toolu_1' };
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const count = (kind: string) => (db.prepare('SELECT count(*) AS n FROM events WHERE kind = ? AND session_id = ?').get(kind, session) as { n: number }).n;
      const recorded = async (kind: string, n: number) => { for (const until = Date.now() + 10_000; Date.now() < until && count(kind) < n; await new Promise((r) => setTimeout(r, 50))); return count(kind); };
      await hook('SessionStart', { source: 'startup' });
      // The hub reads a session's transcript from where it met it, so its start is in before any entry is written.
      expect(await recorded('session.start', 1)).toBe(1);
      typed('Fix the header test.', 'p1');
      await hook('UserPromptSubmit', { prompt: 'Fix the header test.', prompt_id: 'p1' });
      await hook('PreToolUse', call);
      // Typed while the call runs: the desktop app queues it, and the call's PostToolUse is the next hook, which records it.
      entry({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: session, content: 'still going?' });
      await hook('PostToolUse', call);
      expect(await recorded('user.ask', 2), 'the queued question is recorded at the hook after it was typed').toBe(2);
      await hook('Stop', {});
      db.close();
      // Dequeued: its UserPromptSubmit fires, already recorded.
      typed('still going?', 'p2');
      const answer = await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'UserPromptSubmit', payload('UserPromptSubmit', { prompt: 'still going?', prompt_id: 'p2' }), { ppid: claude.pid }));
      const shown = String((JSON.parse(answer) as { stdout: string }).stdout);
      // A core that reads the prompt's origin from its own event alone finds none for a prompt the queue recorded, and lets it through to the model.
      expect(shown, 'the question is answered in the model\'s place').toContain('"decision":"block"');
      // The stop before it is judged when the core's word of the turn's work reached the server first: its line, else the session's own state.
      expect(shown).toMatch(/"reason":"(says done|finished) · next: (DeepBuild|you)/);
    });
  }, 60_000);
});

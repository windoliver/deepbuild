// Promised checks through the real hub (#120): a stop whose last message promises a check for later sets a wake-up,
// recorded with its quote, due time, count and end; at its time a session with a waiter is woken through it; one
// with none hears it at its next prompt, its row saying so meanwhile; and a fourth set is BLOCKED with its owner.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, reply, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const out = (r: { stdout: string }) => (r.stdout ? JSON.parse(r.stdout) as Record<string, unknown> : {});

/** The record's events of a kind, as the ledger has them. */
function events(root: string, kind: string): Record<string, unknown>[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT data FROM events WHERE kind = ? ORDER BY log_pos').all(kind) as { data: string }[]).map((r) => JSON.parse(r.data) as Record<string, unknown>);
  } finally { db.close(); }
}
function readings(root: string, session: string): string[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT reading FROM session_readings WHERE session_id = ? ORDER BY since').all(session) as { reading: string }[]).map((r) => r.reading);
  } finally { db.close(); }
}
async function until<T>(read: () => T, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  let v = read();
  while (!ok(v) && Date.now() < end) { await sleep(100); v = read(); }
  return v;
}

/** A waiter as deep-hook's is: a cli connection that asks `session.wait` and resolves with what the hub hands it. */
function waiter(root: string, session: string, cwd: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(root, 'hub.sock'));
    let got = '';
    let said = 0;
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      got += chunk;
      const lines = got.split('\n');
      while (lines.length - 1 > said) {
        const line = JSON.parse(lines[said]!) as Record<string, unknown>;
        said++;
        if ('hello' in line) sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role === 'cli') sock.write(`${JSON.stringify({ v: 1, id: 'w1', method: 'session.wait', params: { session, cwd, since: Date.now() } })}\n`);
        else if (line.id === 'w1') { sock.destroy(); if ('error' in line) reject(Error(JSON.stringify(line.error))); else resolve(line.result as Record<string, unknown>); }
      }
    });
    sock.on('error', reject);
  });
}

function session(home: string, id: string) {
  const work = join(home, 'work');
  const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(work, { recursive: true });
  mkdirSync(projects, { recursive: true });
  const transcript = join(projects, `${id}.jsonl`);
  writeFileSync(transcript, '');
  return { work, transcript, payload: (event: string, extra: Record<string, unknown>) => ({ session_id: id, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }) };
}

describe('promised checks through the hub', () => {
  it('sets a wake-up from the stop\'s words and wakes an idle session through its waiter at the time', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    const id = '8d5e6f70-1111-4222-8333-444455556666';
    await withHub(async (root, home) => {
      const s = session(home, id);
      const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, s.payload(event, extra), { ppid: claude.pid }));
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'deploy and check', prompt_id: 'p1' });
      await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'echo deploying' }, tool_use_id: 'c1', permission_mode: 'default' });
      await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo deploying' }, tool_use_id: 'c1', tool_response: { stdout: '' }, permission_mode: 'default' });
      const before = Date.now();
      await hook('Stop', { stop_hook_active: false, last_assistant_message: 'The deploy is running. I\'ll check again in 3 seconds and report.', prompt_id: 'p1' });
      // Claude Code starts the waiter at the stop: the session is idle with it.
      const woke = waiter(root, id, s.work);
      const set = await until(() => events(root, 'promise.set'), (e) => e.length > 0);
      expect(set).toHaveLength(1);
      expect(set[0]).toMatchObject({ quote: 'I\'ll check again in 3 seconds and report.', times_set: 1 });
      expect(Number(set[0]!.due)).toBeGreaterThanOrEqual(before + 3000);
      expect(Number(set[0]!.due)).toBeLessThan(before + 10_000);
      expect(Number(set[0]!.end)).toBe(Number(set[0]!.due) + 24 * 3_600_000);
      const handed = await woke;
      expect(Date.now() - before, 'woken at its time, not long after').toBeLessThan(9000);
      expect(String(handed.text)).toContain('I\'ll check again in 3 seconds and report.');
      expect(String(handed.text)).toContain('promised check is due');
      expect((await until(() => events(root, 'promise.due'), (e) => e.length > 0))[0]).toMatchObject({ promise: set[0]!.promise, route: 'wake' });
      expect((await until(() => events(root, 'promise.woken'), (e) => e.length > 0))[0]).toMatchObject({ promise: set[0]!.promise, via: 'waiter' });
    });
  }, 60_000);

  it('wakes a session whose waiter asks after its promise came due, as after a hub restarted on the record', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    const id = '8d5e6f70-1111-4222-8333-444455557777';
    await withHub(async (root, home) => {
      const s = session(home, id);
      const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, s.payload(event, extra), { ppid: claude.pid }));
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'deploy and check', prompt_id: 'p1' });
      await hook('Stop', { stop_hook_active: false, last_assistant_message: 'I\'ll check again in 2 seconds.', prompt_id: 'p1' });
      // No waiter asks before the time: the promise is due, waiting for the session's next hook.
      const due = await until(() => events(root, 'promise.due'), (e) => e.length > 0);
      expect(due[0]).toMatchObject({ route: 'next_hook' });
      // The waiter asks now: the session wakes at once, through it.
      const handed = await waiter(root, id, s.work);
      expect(String(handed.text)).toContain('I\'ll check again in 2 seconds.');
      expect((await until(() => events(root, 'promise.woken'), (e) => e.length > 0))[0]).toMatchObject({ via: 'waiter' });
    });
  }, 60_000);

  it('with no route to wake the session, shows the due promise on its row and carries it at its next prompt; a fourth set is BLOCKED', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    const id = '9e6f7081-1111-4222-8333-444455556666';
    await withHub(async (root, home) => {
      const s = session(home, id);
      const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, s.payload(event, extra), { ppid: claude.pid }));
      await hook('SessionStart', { source: 'startup' });
      const turn = async (n: number, message: string) => {
        const prompt = await hook('UserPromptSubmit', { prompt: `go ${n}`, prompt_id: `p${n}` });
        await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: `echo ${n}` }, tool_use_id: `c${n}`, permission_mode: 'default' });
        await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: `echo ${n}` }, tool_use_id: `c${n}`, tool_response: { stdout: '' }, permission_mode: 'default' });
        await hook('Stop', { stop_hook_active: false, last_assistant_message: message, prompt_id: `p${n}` });
        return prompt;
      };
      await turn(1, 'Still building. I will look again in 2 seconds.');
      const first = (await until(() => events(root, 'promise.set'), (e) => e.length > 0))[0]!;
      // Due, with nothing to wake it: the row says so from its time, and no wake-up fires.
      const due = await until(() => events(root, 'promise.due'), (e) => e.length > 0);
      expect(due[0]).toMatchObject({ promise: first.promise, route: 'next_hook' });
      const row = await until(() => readings(root, id), (r) => r.some((x) => x.includes('promised check is due')));
      expect(row.some((x) => x.includes('I will look again in 2 seconds.'))).toBe(true);
      expect(events(root, 'promise.woken')).toHaveLength(0);
      // The next prompt carries it, with its quote and due time.
      const carried = await turn(2, 'Still building. I will look again in 2 seconds.');
      const context = String(((out(carried).hookSpecificOutput ?? {}) as Record<string, unknown>).additionalContext ?? '');
      expect(context).toContain('promised check is due');
      expect(context).toContain('I will look again in 2 seconds.');
      expect(context).toMatch(/\d{1,2}:\d{2}/);
      expect((await until(() => events(root, 'promise.woken'), (e) => e.length > 0))[0]).toMatchObject({ promise: first.promise, via: 'next_prompt' });
      // Set again at each stop: the fourth set is BLOCKED with its owner, one ask, and no wake-up fires for it.
      const second = await until(() => events(root, 'promise.set'), (e) => e.length >= 2);
      expect(second[1]).toMatchObject({ promise: first.promise, times_set: 2 });
      await until(() => events(root, 'promise.due'), (e) => e.length >= 2);
      await turn(3, 'Still building. I will look again in 2 seconds.');
      await until(() => events(root, 'promise.set'), (e) => e.length >= 3);
      await until(() => events(root, 'promise.due'), (e) => e.length >= 3);
      await turn(4, 'Still building. I will look at CI again in 2 seconds.');
      const blocked = await until(() => events(root, 'promise.blocked'), (e) => e.length > 0);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]).toMatchObject({ promise: first.promise, cause: 'set_again', owner: 'service' });
      expect(typeof blocked[0]!.ask === 'string' || blocked[0]!.ask === null).toBe(true);
      await sleep(3000);
      expect(events(root, 'promise.set')).toHaveLength(3);
      expect(events(root, 'promise.due')).toHaveLength(3);
      expect(readings(root, id).some((x) => x.startsWith('BLOCKED (cause: promise set 4 times, owner: service)'))).toBe(true);
    });
  }, 90_000);
});

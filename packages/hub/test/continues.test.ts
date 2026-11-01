// A continue the asks core records while the hub opens (#85): a task's check that passed while the hub was down
// closes the task as the core replays, and the hub carries each continue that records then, never skipping it as
// one it already carried. Without a route open, the carry is the reading that says the continue goes with the
// session's next prompt. And a turn that ends in StopFailure ends like any other: the waiter its earlier stop started
// wakes the session with the continue, so nothing needs typing.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openRecord } from '@deepbuild/record';
import { ulid } from '../src/wire.js';
import { hookLine, reply, send, withHub } from './hub.js';

const SESSION = '3b9f1c2e-1111-4222-8333-444455556666';

/** Rows of the record, read while or after the hub runs. */
function rows<T>(root: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all(...params) as T[]; } finally { db.close(); }
}
async function until<T>(probe: () => T[], ms: number): Promise<T[]> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) { const got = probe(); if (got.length) return got; }
  return probe();
}

describe('a continue recorded as the hub opens', () => {
  it('is carried into the session, not skipped as already carried', async () => {
    await withHub(async (root, home, { restart }) => {
      // Your settings, as setup drafts them: an unblock task's deadline and default come from here.
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: {
        deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
        default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
        fallback: ['change-owner'], fold: 5,
      } }));
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'turn-1', promptId: 'p1', message: { role: 'user', content: 'go' }, origin: { kind: 'human' } })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: SESSION, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      expect(await hook('UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' })).toContain('"ack"');
      // The session stops on a revoked sign-in: the hook records the cause and the core raises the block's task.
      expect(await hook('StopFailure', { error: 'authentication_failed', prompt_id: 'p1' })).toContain('"ack"');
      const [task] = await until(() => rows<{ id: string; proves: string }>(root, "SELECT id, json_extract(data, '$.proves') AS proves FROM events WHERE kind = 'ask.created' AND json_extract(data, '$.kind') = 'unblock' AND session_id = ?", SESSION), 10_000);
      expect(task, 'the stop raised one unblock task').toBeDefined();
      // While the hub is down, the task's check passes: the runner's verdict lands in the record.
      await restart({}, async () => {
        const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
        try {
          const now = Date.now();
          const commit = '0'.repeat(40);
          const claim = `claim:${ulid(now)}`;
          const id = ulid(now + 1);
          await record.append({ writer: 'core', actor: 'you', scope: 'you', session: SESSION }, { v: 1, id, kind: 'verdict.made', subject: claim, ts: now, data: {
            outcome: 'PASS', verdict: `verdict:${id}`, claim, reasons: [], smallest: null, points_to: null, commit,
            requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: task!.proves, depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: [] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
            key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'test', tools: [] },
          } });
        } finally {
          await record.close();
        }
      });
      // The hub, back up, settles the task closed and continues the session; with no route open, the record says the
      // continue goes with its next prompt.
      const continued = await until(() => rows<{ because: string }>(root, "SELECT json_extract(data, '$.because') AS because FROM events WHERE kind = 'session.continued' AND session_id = ?", SESSION), 10_000);
      expect(continued.map((c) => c.because), 'the task closed on its check, so the session continues once').toEqual(['task_closed']);
      const carried = await until(() => rows<{ r: string }>(root, "SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", SESSION), 5_000);
      expect(carried.map((c) => c.r), 'the hub carried the continue it found on opening').toEqual([`DeepBuild continues this session (task_closed, task ask:${task!.id}), but no route into it is open now: the continue goes with its next prompt.`]);
      expect(rows(root, "SELECT 1 FROM events WHERE kind = 'ask.moot' AND subject = ?", `ask:${task!.id}`), 'the task is moot').toHaveLength(1);
      await new Promise((r) => setTimeout(r, 1500));
      expect(rows(root, "SELECT 1 FROM events WHERE kind = 'session.continued' AND session_id = ?", SESSION), 'continued once, carried once').toHaveLength(1);
      expect(rows(root, "SELECT 1 FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", SESSION)).toHaveLength(1);
    });
  }, 60_000);
});

/**
 * The waiter, as Claude Code's Stop entry runs it: one `session.wait` on a cli connection, held until the hub hands
 * it something to wake the session with. Resolves with that reply, or undefined at `ms`.
 */
function waiter(root: string, session: string, ms: number): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const sock = net.connect(join(root, 'hub.sock'));
    const lines: Record<string, unknown>[] = [];
    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); resolve(undefined); }, ms);
    sock.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
      if (lines.length === 1) sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
      if (lines.some((l) => l.role) && !lines.some((l) => l.sent)) {
        lines.push({ sent: true });
        sock.write(`${JSON.stringify({ v: 1, id: 'w1', method: 'session.wait', params: { session, since: Date.now(), cwd: '/tmp' } })}\n`);
      }
      const reply = lines.find((l) => l.id === 'w1');
      if (reply) { clearTimeout(timer); sock.destroy(); resolve((reply.result ?? reply.error) as Record<string, unknown>); }
    });
    sock.on('error', () => { clearTimeout(timer); resolve(undefined); });
  });
}

describe('a turn that ends in StopFailure', () => {
  it('ends the turn: the waiter its earlier stop started wakes the session with the automatic continue', async () => {
    await withHub(async (root, home) => {
      const id = '4c0a2d3f-2222-4333-8444-555566667777';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // Turn 1 you typed ends with a Stop, and Claude Code starts the waiter.
      typed('list the files', 'p1');
      expect(await hook('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' })).toContain('"ack"');
      expect(await hook('Stop', { prompt_id: 'p1', stop_hook_active: false, last_assistant_message: 'Done.' })).toContain('"ack"');
      await new Promise((r) => setTimeout(r, 300));
      const woken = waiter(root, id, 15_000);
      await new Promise((r) => setTimeout(r, 300));
      // Turn 2 you typed ends on an overloaded service: Claude Code fires StopFailure instead of Stop, and no new waiter.
      typed('now run the tests', 'p2');
      expect(await hook('UserPromptSubmit', { prompt: 'now run the tests', prompt_id: 'p2' })).toContain('"ack"');
      expect(await hook('StopFailure', { error: 'overloaded', prompt_id: 'p2' })).toContain('"ack"');
      const reply = await woken;
      expect(rows<{ because: string }>(root, "SELECT json_extract(data, '$.because') AS because FROM events WHERE kind = 'session.continued' AND session_id = ?", id).map((c) => c.because), 'the core continued the session once').toEqual(['transient']);
      expect(reply, 'the waiter woke the session with the continue, with nothing typed').toMatchObject({ session: id, text: expect.stringContaining('one automatic continue') });
    });
  }, 60_000);

  it('of an older turn, arriving after the prompt you queued, does not wake the session while that prompt runs', async () => {
    await withHub(async (root, home) => {
      const id = '5d1b3e4a-3333-4444-8555-666677778888';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      typed('list the files', 'p1');
      expect(await hook('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' })).toContain('"ack"');
      expect(await hook('Stop', { prompt_id: 'p1', stop_hook_active: false, last_assistant_message: 'Done.' })).toContain('"ack"');
      await new Promise((r) => setTimeout(r, 300));
      const woken = waiter(root, id, 6_000);
      await new Promise((r) => setTimeout(r, 300));
      // Turn 2 fails, and the prompt you queued meanwhile starts at once: its hook is stamped before turn 2's
      // StopFailure, so the StopFailure arrives while turn 3 runs.
      typed('now run the tests', 'p2');
      expect(await hook('UserPromptSubmit', { prompt: 'now run the tests', prompt_id: 'p2' })).toContain('"ack"');
      typed('and fix what fails', 'p3');
      expect(await hook('UserPromptSubmit', { prompt: 'and fix what fails', prompt_id: 'p3' })).toContain('"ack"');
      expect(await hook('StopFailure', { error: 'overloaded', prompt_id: 'p2' })).toContain('"ack"');
      expect(await woken, 'no wake while turn 3 runs').toBeUndefined();
    });
  }, 60_000);
});

describe('a continue parked for the next prompt', () => {
  it('outlives the session starting again: a resumed session gets it with its next prompt', async () => {
    await withHub(async (root, home) => {
      const id = '6e2c4f5b-4444-4555-8666-777788889999';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      typed('list the files', 'p1');
      expect(await hook('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' })).toContain('"ack"');
      // The first turn ends on an overloaded service, with no waiter: the continue is parked for the next prompt.
      expect(await hook('StopFailure', { error: 'overloaded', prompt_id: 'p1' })).toContain('"ack"');
      expect(await until(() => rows(root, "SELECT 1 FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", id), 10_000), 'parked for the next prompt').toHaveLength(1);
      // You quit Claude Code and resume the session later.
      expect(await hook('SessionEnd', { reason: 'prompt_input_exit' })).toContain('"ack"');
      expect(await hook('SessionStart', { source: 'resume' })).toContain('"ack"');
      typed('go on', 'p2');
      const said = await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), 'UserPromptSubmit', { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: 'UserPromptSubmit', prompt: 'go on', prompt_id: 'p2' }, { ppid: process.pid }));
      expect(said.stdout, 'the next prompt of the resumed session carries the continue').toContain('one automatic continue');
    });
  }, 60_000);
  it('outlives the hub restarting: the next prompt after it gets the continue once, and the one after does not', async () => {
    await withHub(async (root, home, { restart }) => {
      const id = '7f3d5a6c-5555-4666-8777-88889999aaaa';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const line = (event: string, extra: Record<string, unknown>) => hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid });
      expect(await send(join(root, 'hub.sock'), line('SessionStart', { source: 'startup' }))).toContain('"ack"');
      typed('list the files', 'p1');
      expect(await send(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' }))).toContain('"ack"');
      expect(await send(join(root, 'hub.sock'), line('StopFailure', { error: 'overloaded', prompt_id: 'p1' }))).toContain('"ack"');
      expect(await until(() => rows(root, "SELECT 1 FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", id), 10_000), 'parked for the next prompt').toHaveLength(1);
      // The hub restarts, an update say, before you type again.
      await restart({}, async () => undefined);
      typed('go on', 'p2');
      const said = await reply(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: 'go on', prompt_id: 'p2' }));
      expect(said.stdout, 'the first prompt after the restart carries the continue').toContain('one automatic continue');
      expect(await send(join(root, 'hub.sock'), line('Stop', { stop_hook_active: false, prompt_id: 'p2' }))).toContain('"ack"');
      typed('and the tests', 'p3');
      const next = await reply(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: 'and the tests', prompt_id: 'p3' }));
      expect(next.stdout, 'carried once').not.toContain('one automatic continue');
      // A second restart after the prompt carried it parks nothing again.
      await restart({}, async () => undefined);
      typed('and the docs', 'p4');
      const after = await reply(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: 'and the docs', prompt_id: 'p4' }));
      expect(after.stdout, 'a carried continue is not rebuilt').not.toContain('one automatic continue');
    });
  }, 60_000);
  it('is not repeated to the prompt that already shows it: a wake the waiter took before the hub restarted', async () => {
    await withHub(async (root, home, { restart }) => {
      const id = '7f3d5a6c-5555-4666-8777-88889999aaab';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const line = (event: string, extra: Record<string, unknown>) => hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid });
      expect(await send(join(root, 'hub.sock'), line('SessionStart', { source: 'startup' }))).toContain('"ack"');
      typed('list the files', 'p1');
      expect(await send(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' }))).toContain('"ack"');
      expect(await send(join(root, 'hub.sock'), line('StopFailure', { error: 'overloaded', prompt_id: 'p1' }))).toContain('"ack"');
      expect(await until(() => rows(root, "SELECT 1 FROM events WHERE kind = 'session.continued' AND session_id = ?", id), 10_000)).toHaveLength(1);
      await restart({}, async () => undefined);
      const wake = '<task-notification> Stop hook blocking error: DeepBuild: this turn stopped on a dropped connection or an overloaded service. Continue where you left off; this is its one automatic continue.</task-notification>';
      typed(wake, 'p2');
      const said = await reply(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: wake, prompt_id: 'p2' }));
      expect(said.stdout, 'the prompt shows it already').not.toContain('one automatic continue');
    });
  }, 60_000);
});

describe('a first turn that ends in StopFailure', () => {
  it('has the waiter its StopFailure started wake the session with the continue parked before it connected', async () => {
    await withHub(async (root, home) => {
      const id = '7f3d5a6c-5555-4666-8777-88889999aaaa';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'p1', promptId: 'p1', message: { role: 'user', content: 'list the files' }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      expect(await hook('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' })).toContain('"ack"');
      // The session's first turn ends on an overloaded service: no stop of it started a waiter yet, so the continue the
      // core records is parked for the next prompt.
      expect(await hook('StopFailure', { error: 'overloaded', prompt_id: 'p1' })).toContain('"ack"');
      expect(await until(() => rows(root, "SELECT 1 FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", id), 10_000), 'parked for the next prompt').toHaveLength(1);
      // Claude Code starts the waiter the StopFailure entry names; it connects after the continue was parked.
      const woke = await waiter(root, id, 10_000);
      expect(woke, 'the waiter woke the session with the parked continue, with nothing typed').toMatchObject({ session: id, text: expect.stringContaining('one automatic continue') });
      // Claude Code's wake turn: its prompt is the waiter's words, as Claude Code 2.1.308 sends it.
      const wake = `<task-notification> <summary>Stop hook feedback</summary> </task-notification> <system-reminder> Stop hook blocking error from command "StopFailure:overloaded": ${String(woke?.text)} </system-reminder>`;
      expect(await hook('UserPromptSubmit', { prompt: wake, prompt_id: 'pw' })).toContain('"ack"');
      // Shown by the wake turn, it no longer waits for the next prompt.
      const said = await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), 'UserPromptSubmit', { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: 'UserPromptSubmit', prompt: 'go on', prompt_id: 'p2' }, { ppid: process.pid }));
      expect(said.stdout, 'carried once').not.toContain('one automatic continue');
    });
  }, 60_000);

  it('keeps the continue it handed a waiter that never woke the session: your next prompt carries it', async () => {
    await withHub(async (root, home) => {
      const id = '8a4e6b7d-6666-4777-8888-9999aaaabbbb';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      typed('list the files', 'p1');
      expect(await hook('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' })).toContain('"ack"');
      expect(await hook('StopFailure', { error: 'overloaded', prompt_id: 'p1' })).toContain('"ack"');
      await until(() => rows(root, "SELECT 1 FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", id), 10_000);
      expect(await waiter(root, id, 10_000), 'handed to the waiter').toMatchObject({ text: expect.stringContaining('one automatic continue') });
      // Claude Code never started the wake turn; you type instead.
      typed('are you there?', 'p2');
      const said = await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), 'UserPromptSubmit', { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: 'UserPromptSubmit', prompt: 'are you there?', prompt_id: 'p2' }, { ppid: process.pid }));
      expect(said.stdout, 'the prompt you typed carries the continue no wake showed').toContain('one automatic continue');
    });
  }, 60_000);
});

describe('a spend limit', () => {
  it('stops each session as a block only you can clear, and its sessions share one task', async () => {
    await withHub(async (root, home) => {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: {
        deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
        default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
        fallback: ['change-owner'], fold: 5,
      } }));
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const sessions = ['9b5f7c8e-7777-4888-8999-aaaabbbbcccc', '9b5f7c8e-7777-4888-8999-aaaabbbbcccd'];
      let n = 0;
      for (const id of sessions) {
        const transcript = join(project, `${id}.jsonl`);
        writeFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'p1', promptId: 'p1', message: { role: 'user', content: 'go' }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
        const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
        expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
        expect(await hook('UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' })).toContain('"ack"');
        // Claude Code ends the turn on the account's spend limit: its hooks reference names this error billing_error.
        expect(await hook('StopFailure', { error: 'billing_error', prompt_id: 'p1' })).toContain('"ack"');
      }
      const stopsOf = () => rows<{ cause: string; owner: string; signature: string }>(root, "SELECT json_extract(data, '$.cause') AS cause, json_extract(data, '$.owner') AS owner, json_extract(data, '$.signature') AS signature FROM events WHERE kind = 'agent.stop'");
      await until(() => (stopsOf().length >= 2 ? [1] : []), 10_000);
      const stops = stopsOf();
      expect(stops.map((s) => [s.cause, s.owner]), 'each stop is a rate limit only you can raise').toEqual([['rate_limited', 'you'], ['rate_limited', 'you']]);
      expect(new Set(stops.map((s) => s.signature)).size, 'one cause, one signature').toBe(1);
      const open = () => rows<{ id: string }>(root, "SELECT id FROM events WHERE kind = 'ask.created' AND json_extract(data, '$.kind') = 'unblock' AND 'ask:' || id NOT IN (SELECT subject FROM events WHERE kind = 'ask.superseded')");
      await until(open, 10_000);
      await new Promise((r) => setTimeout(r, 500));
      expect(open(), 'both sessions share one open task').toHaveLength(1);
    });
  }, 60_000);
  it('is yours to clear even from a StopFailure that names no prompt, so no turn is read', async () => {
    await withHub(async (root, home) => {
      const id = '9b5f7c8e-7777-4888-8999-aaaabbbbccce';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'p1', promptId: 'p1', message: { role: 'user', content: 'go' }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      expect(await hook('UserPromptSubmit', { prompt: 'go' })).toContain('"ack"');
      expect(await hook('StopFailure', { error: 'billing_error' })).toContain('"ack"');
      const stops = await until(() => rows<{ cause: string; owner: string }>(root, "SELECT json_extract(data, '$.cause') AS cause, json_extract(data, '$.owner') AS owner FROM events WHERE kind = 'agent.stop'"), 10_000);
      expect(stops.map((s) => [s.cause, s.owner])).toEqual([['rate_limited', 'you']]);
    });
  }, 60_000);
});

describe('a dropped connection', () => {
  it('stops the session as a transient the service owns, and continues it once by itself', async () => {
    await withHub(async (root, home) => {
      // The service answers: the hub's try of its host, a real connection, succeeds.
      const service = net.createServer((c) => c.destroy());
      await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
      mkdirSync(join(home, '.claude'), { recursive: true });
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${(service.address() as net.AddressInfo).port}` } }));
      service.unref();
      const id = 'ab6f8d9f-8888-4999-8aaa-bbbbccccdddd';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'p1', promptId: 'p1', message: { role: 'user', content: 'go' }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
      // Claude Code 2.1.308 when the API can't be reached: StopFailure says server_error, and the turn's API error entry
      // says the same with its text (recorded live, a connection refused).
      appendFileSync(transcript, `${JSON.stringify({ type: 'assistant', uuid: 'a1', isApiErrorMessage: true, error: 'server_error', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)' }] } })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      expect(await hook('UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' })).toContain('"ack"');
      expect(await hook('StopFailure', { error: 'server_error', prompt_id: 'p1', last_assistant_message: 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)' })).toContain('"ack"');
      const [stop] = await until(() => rows<{ cause: string; owner: string }>(root, "SELECT json_extract(data, '$.cause') AS cause, json_extract(data, '$.owner') AS owner FROM events WHERE kind = 'agent.stop' AND session_id = ?", id), 10_000);
      expect([stop?.cause, stop?.owner], 'a dropped connection is a timeout the service owns').toEqual(['timed_out', 'service']);
      const continued = await until(() => rows<{ because: string }>(root, "SELECT json_extract(data, '$.because') AS because FROM events WHERE kind = 'session.continued' AND session_id = ?", id), 10_000);
      expect(continued.map((c) => c.because), 'one automatic continue').toEqual(['transient']);
    });
  }, 60_000);
});

describe('the turn a stop cut off (#85)', () => {
  it('names each send call that started with no recorded end as outcome unknown in the continue, and denies the identical send at PreToolUse', async () => {
    await withHub(async (root, home) => {
      const id = '8a4e6b7d-6666-4777-8888-9999aaaabbbb';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, turnOrigin: 'human', promptSource: 'typed' })}\n`);
      let n = 0;
      const line = (event: string, extra: Record<string, unknown>) => hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid });
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), line(event, extra));
      const CMD = 'gh pr create --title "Tasks that close themselves" --body "Part of #85"';
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      typed('list the files', 'p1');
      expect(await hook('UserPromptSubmit', { prompt: 'list the files', prompt_id: 'p1' })).toContain('"ack"');
      expect(await hook('Stop', { prompt_id: 'p1', stop_hook_active: false, last_assistant_message: 'Done.' })).toContain('"ack"');
      await new Promise((r) => setTimeout(r, 300));
      const woken = waiter(root, id, 15_000);
      await new Promise((r) => setTimeout(r, 300));
      // Turn 2 opens the pull request, and the connection drops before the call's PostToolUse reaches the hub.
      typed('open the PR', 'p2');
      expect(await hook('UserPromptSubmit', { prompt: 'open the PR', prompt_id: 'p2' })).toContain('"ack"');
      expect(await hook('PreToolUse', { prompt_id: 'p2', tool_name: 'Bash', tool_input: { command: CMD }, tool_use_id: 'c1', permission_mode: 'default' })).toContain('"ack"');
      expect(await hook('StopFailure', { error: 'overloaded', prompt_id: 'p2' })).toContain('"ack"');
      const woke = await woken;
      expect(woke, 'the waiter woke the session with the continue').toMatchObject({ session: id, text: expect.stringContaining('one automatic continue') });
      const text = String(woke!.text);
      expect(text, 'the continue names the cut-off call, marked outcome unknown').toContain(`Bash \`${CMD}\` (outcome unknown)`);
      expect(rows(root, "SELECT 1 FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE '%outcome unknown%'", id), 'the record keeps the block the session heard').toHaveLength(1);
      // The wake's turn runs the identical send again: denied, with what the hub knows of the earlier one.
      typed(text, 'p3');
      expect(await hook('UserPromptSubmit', { prompt: text, prompt_id: 'p3' })).toContain('"ack"');
      const denied = await reply(join(root, 'hub.sock'), line('PreToolUse', { prompt_id: 'p3', tool_name: 'Bash', tool_input: { command: CMD }, tool_use_id: 'c2', permission_mode: 'default' }));
      expect(denied.exit, 'the identical send is denied').toBe(2);
      expect(denied.stderr).toContain('DeepBuild denied this');
      expect(denied.stderr).toContain('outcome is unknown');
      // A different call runs; and once told, the agent's next identical call is its own informed choice.
      const other = await reply(join(root, 'hub.sock'), line('PreToolUse', { prompt_id: 'p3', tool_name: 'Bash', tool_input: { command: 'gh pr list --head main' }, tool_use_id: 'c3', permission_mode: 'default' }));
      expect(other.exit, 'a different call runs').toBe(0);
      const again = await reply(join(root, 'hub.sock'), line('PreToolUse', { prompt_id: 'p3', tool_name: 'Bash', tool_input: { command: CMD }, tool_use_id: 'c4', permission_mode: 'default' }));
      expect(again.exit, 'denied once, with the earlier result').toBe(0);
    });
  }, 60_000);
});

describe('a stop whose task is open (#85)', () => {
  it('holds the turns DeepBuild would start there: a promised check due wakes nothing until the task closes, then goes with the resume', async () => {
    await withHub(async (root, home, { restart }) => {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: {
        deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
        default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
        fallback: ['change-owner'], fold: 5,
      } }));
      const id = '9b5f7c8e-7777-4888-8999-aaaabbbbcccc';
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${id}.jsonl`);
      writeFileSync(transcript, '');
      const typed = (prompt: string, promptId: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, turnOrigin: 'human', promptSource: 'typed' })}\n`);
      let n = 0;
      const line = (event: string, extra: Record<string, unknown>) => hookLine(ulid(Date.now() + ++n), event, { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid });
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), line(event, extra));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // Turn 1 ends with a promise: the check's wake-up is due in 20 s. Claude Code starts the waiter.
      typed('push and watch CI', 'p1');
      expect(await hook('UserPromptSubmit', { prompt: 'push and watch CI', prompt_id: 'p1' })).toContain('"ack"');
      expect(await hook('Stop', { prompt_id: 'p1', stop_hook_active: false, last_assistant_message: "Pushed. I'll check back in 20 seconds to see whether CI passed." })).toContain('"ack"');
      expect(await until(() => rows(root, "SELECT 1 FROM events WHERE kind = 'promise.set' AND session_id = ?", id), 5_000), 'the promise is set').toHaveLength(1);
      // Turn 2 stops on a revoked sign-in: its task is open, and the session's row carries the cause. Claude Code
      // starts the waiter at the StopFailure too, so the session is idle with a waiter when the check comes due.
      typed('now the docs', 'p2');
      expect(await hook('UserPromptSubmit', { prompt: 'now the docs', prompt_id: 'p2' })).toContain('"ack"');
      expect(await hook('StopFailure', { error: 'authentication_failed', prompt_id: 'p2' })).toContain('"ack"');
      await new Promise((r) => setTimeout(r, 300));
      const woken = waiter(root, id, 30_000);
      const [task] = await until(() => rows<{ id: string; proves: string }>(root, "SELECT id, json_extract(data, '$.proves') AS proves FROM events WHERE kind = 'ask.created' AND json_extract(data, '$.kind') = 'unblock' AND session_id = ?", id), 10_000);
      expect(task, 'the stop raised one unblock task').toBeDefined();
      // The promised check comes due while the task is open: no turn DeepBuild causes starts in the stopped session.
      const due = await until(() => rows<{ route: string }>(root, "SELECT json_extract(data, '$.route') AS route FROM events WHERE kind = 'promise.due' AND session_id = ?", id), 30_000);
      expect(due.map((d) => d.route), 'the due check waits on the row, not the waiter').toEqual(['next_hook']);
      expect(await Promise.race([woken, new Promise((r) => setTimeout(() => r('still waiting'), 2_000))]), 'no waiter fires while the sign-in task is open').toBe('still waiting');
      // The task's check passes (/login) while the hub is down; back up, the task closes and the session resumes.
      await restart({}, async () => {
        const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
        try {
          const now = Date.now();
          const commit = '0'.repeat(40);
          const claim = `claim:${ulid(now)}`;
          const vid = ulid(now + 1);
          await record.append({ writer: 'core', actor: 'you', scope: 'you', session: id }, { v: 1, id: vid, kind: 'verdict.made', subject: claim, ts: now, data: {
            outcome: 'PASS', verdict: `verdict:${vid}`, claim, reasons: [], smallest: null, points_to: null, commit,
            requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: task!.proves, depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: [] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
            key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'test', tools: [] },
          } });
        } finally {
          await record.close();
        }
      });
      const continued = await until(() => rows<{ because: string }>(root, "SELECT json_extract(data, '$.because') AS because FROM events WHERE kind = 'session.continued' AND session_id = ?", id), 10_000);
      expect(continued.map((c) => c.because), 'the task closed on its check, so the session resumes').toEqual(['task_closed']);
      // Claude Code's waiter, back after the restart, is woken: the due check goes now, and the resume goes with the wake's prompt.
      const woke = await waiter(root, id, 10_000);
      expect(woke, 'the waiter wakes the session once the task closed').toMatchObject({ session: id, text: expect.stringContaining('promised check') });
      typed(String(woke!.text), 'p3');
      const said = await reply(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: String(woke!.text), prompt_id: 'p3' }));
      expect(said.stdout, 'the resume arrives in the woken turn').toContain('closed. Continue where you left off');
    });
  }, 90_000);
});

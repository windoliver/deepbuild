// The hub writes a session's spend off a stop's hook (#45), whether or not the stop names its prompt, and a subagent's stop
// doesn't count it again.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '6b3e4f50-2222-4333-8444-555566667777';

describe('turn.usage at a stop', () => {
  it('records the transcript\'s running total for a stop with no prompt_id, and none for a subagent\'s', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid: claude.pid }));
      const usages = () => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try { return (db.prepare("SELECT data FROM events WHERE kind = 'turn.usage'").all() as { data: string }[]).map((r) => JSON.parse(r.data) as { covers: string; tokens: { input: number; cached: number; output: number } }); } finally { db.close(); }
      };
      const until = async (n: number) => { for (let i = 0; i < 100 && usages().length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
      await hook('SessionStart', { source: 'startup' });
      await until(0);
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'go' } })}\n${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 1 } } })}\n`);
      await hook('Stop', { stop_hook_active: false, last_assistant_message: 'ok' });
      await until(1);
      expect(usages().map((u) => [u.covers, u.tokens.input, u.tokens.cached, u.tokens.output])).toEqual([['session', 11, 20, 5]]);
      await hook('SubagentStop', { agent_id: 'a1', stop_hook_active: false });
      await new Promise((r) => setTimeout(r, 500));
      expect(usages(), 'a subagent\'s stop adds no row').toHaveLength(1);
    });
  }, 60_000);
});

describe('Codex\'s usage', () => {
  it('reads the session\'s total from its rollout at a stop, unpriced', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      mkdirSync(work, { recursive: true });
      const transcript = join(home, 'rollout.jsonl');
      writeFileSync(transcript, [
        { type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-5-codex' } },
        { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 }, last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7, total_tokens: 107 } } } },
      ].map((l) => JSON.stringify(l)).join('\n') + '\n');
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, turn_id: 't1', model: 'gpt-5-codex', ...extra }, { ppid: claude.pid, agent: 'codex' }));
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'go' });
      await hook('Stop', { stop_hook_active: false, last_assistant_message: 'ok' });
      const usages = () => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try { return (db.prepare("SELECT data FROM events WHERE kind = 'turn.usage'").all() as { data: string }[]).map((r) => JSON.parse(r.data) as { cost: unknown; tokens: { output: number } }); } finally { db.close(); }
      };
      for (let i = 0; i < 100 && !usages().length; i++) await new Promise((r) => setTimeout(r, 100));
      expect(usages()[0]?.cost).toEqual({ basis: 'unpriced' });
      expect(usages()[0]?.tokens.output).toBe(7);
    });
  }, 60_000);
});

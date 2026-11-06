// A prompt you type is yours even though Claude Code writes its transcript entry only once the prompt's hooks have
// returned (#567): the core places the prompt's origin after its hook, before the session's next hook or a moment
// later, never as unknown, which would open no task and leave the turn's stop unjudged.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, reply, send, withHub } from './hub.js';

const SESSION = '5c2d7e1f-2222-4333-8444-555566667777';
const TEXT = 'Make checkToken reject expired tokens.';

function rows<T>(root: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all(...params) as T[]; } finally { db.close(); }
}
async function until<T>(probe: () => T[], ms: number): Promise<T[]> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) { const got = probe(); if (got.length) return got; }
  return probe();
}
/** A session whose transcript starts empty, and its hooks as Claude Code fires them. */
function session(root: string, home: string) {
  const project = join(home, '.claude', 'projects', 'tmp');
  mkdirSync(project, { recursive: true });
  const transcript = join(project, `${SESSION}.jsonl`);
  writeFileSync(transcript, '');
  let n = 0;
  const line = (event: string, extra: Record<string, unknown>) => hookLine(ulid(Date.now() + ++n), event, { session_id: SESSION, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid });
  const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), line(event, extra));
  // The prompt's hook as deep-hook runs it: Claude Code goes on only once the hub's reply is in.
  const prompted = () => reply(join(root, 'hub.sock'), line('UserPromptSubmit', { prompt: TEXT, prompt_id: 'p1' }));
  // The prompt's entry, as Claude Code 2.1.308 writes it once the prompt's hooks have returned.
  const entry = () => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'turn-1', promptId: 'p1', promptSource: 'typed', turnOrigin: 'human', message: { role: 'user', content: TEXT }, origin: { kind: 'human' } })}\n`);
  return { hook, prompted, entry };
}

describe('a typed prompt whose transcript entry Claude Code writes after its hook', () => {
  it('is recorded as yours, ahead of the tool call that follows it', async () => {
    await withHub(async (root, home) => {
      const { hook, prompted, entry } = session(root, home);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      expect((await prompted()).exit).toBe(0);
      entry();
      expect(await hook('PreToolUse', { tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/tmp/src/auth.js' }, prompt_id: 'p1' })).toContain('"ack"');
      const order = await until(() => rows<{ kind: string; f: string | null }>(root, "SELECT kind, json_extract(data, '$.from') AS f FROM events WHERE session_id = ? AND kind IN ('user.ask', 'tool.before') ORDER BY log_pos", SESSION).filter((_, _i, all) => all.length >= 2), 10_000);
      expect(order.map((r) => r.kind), 'the prompt is recorded before the tool call its turn made').toEqual(['user.ask', 'tool.before']);
      expect(order[0]?.f, 'the prompt you typed is yours, not of an unknown origin').toBe('person');
    });
  }, 60_000);

  it('is recorded as yours when no hook follows it', async () => {
    await withHub(async (root, home) => {
      const { hook, prompted, entry } = session(root, home);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      expect((await prompted()).exit).toBe(0);
      entry();
      const [ask] = await until(() => rows<{ f: string }>(root, "SELECT json_extract(data, '$.from') AS f FROM events WHERE kind = 'user.ask' AND session_id = ?", SESSION), 15_000);
      expect(ask?.f, 'the prompt you typed is yours, not of an unknown origin').toBe('person');
    });
  }, 60_000);
});

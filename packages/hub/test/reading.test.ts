// The "hooks not reaching DeepBuild" reading (#315) is judged on the hub's own clock: a session whose hooks carry
// stamps from a clock stepped back still gets it for a turn none of whose hooks reached the hub, and a hub restarted
// mid-session judges the turns it missed.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hookLine, send, withHub } from './hub.js';

const SESSION = '7a2d3c0f-2222-4333-8444-555566667777';
/** October 2025: a year behind the hub's clock. */
const BEHIND = 1_760_013_451_123_456_789n;

/** A session's transcript under the temp home, the hooks it sends, and the readings the record holds for it. */
function session(root: string, home: string, seq: (n: number) => string) {
  const project = join(home, '.claude', 'projects', 'tmp');
  mkdirSync(project, { recursive: true });
  const transcript = join(project, `${SESSION}.jsonl`);
  writeFileSync(transcript, '');
  let n = 0;
  return {
    line: (o: unknown) => appendFileSync(transcript, `${JSON.stringify(o)}\n`),
    /** Sends a hook and waits until its event is in the record: the hub acknowledges before it reads the transcript. */
    hook: async (event: string, extra: Record<string, unknown> = {}) => {
      n++;
      const id = `01K74FKZVKZGATTBZAEGPRE${String(n).padStart(3, '0')}`;
      const payload = { session_id: SESSION, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra };
      const ack = await send(join(root, 'hub.sock'), hookLine(id, event, payload, { seq: seq(n), ppid: process.pid }));
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        for (const until = Date.now() + 3000; Date.now() < until && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(id); await new Promise((r) => setTimeout(r, 10)));
      } finally {
        db.close();
      }
      return ack;
    },
    /** The readings, once there are any, and after a second more, so one recorded twice shows. */
    readings: async () => {
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const read = () => (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading'").all() as { r: string }[]).map((x) => x.r);
      try {
        for (const until = Date.now() + 3000; Date.now() < until && !read().length; await new Promise((r) => setTimeout(r, 50)));
        await new Promise((r) => setTimeout(r, 1000));
        return read();
      } finally {
        db.close();
      }
    },
  };
}

describe('the hooks-not-reaching reading', () => {
  it('is judged on the hub\'s clock, whatever the hooks\' stamps say', async () => {
    await withHub(async (root, home) => {
      const { line, hook, readings } = session(root, home, (n) => String(BEHIND + BigInt(n)));
      // Turn 1 reached the hub.
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      expect(await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_t1' })).toContain('"ack"');
      // Turn 2 ran a call none of whose hooks reached the hub; turn 3's prompt shows it ended.
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'show the status' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t2', name: 'Bash', input: { command: 'git status' } }] } });
      line({ type: 'user', uuid: 'turn-3', message: { role: 'user', content: 'thanks' } });
      expect(await hook('UserPromptSubmit', { prompt: 'thanks' })).toContain('"ack"');
      expect(await readings(), 'turn 2 reached no hook, so the session reads it').toEqual(['hooks not reaching DeepBuild']);
    });
  }, 30_000);

  it('judges the turns a restarted hub missed, and only those', async () => {
    await withHub(async (root, home, restart) => {
      const { line, hook, readings } = session(root, home, () => String(BigInt(Date.now()) * 1_000_000n));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // Turn 1's call reached the hub, which stops before the turn ends.
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      expect(await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_t1' })).toContain('"ack"');
      await restart();
      // While it restarts, turn 1 ends and turn 2 runs a call whose hook never reached it; turn 3's prompt ends turn 2.
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'show the status' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t2', name: 'Bash', input: { command: 'git status' } }] } });
      line({ type: 'user', uuid: 'turn-3', message: { role: 'user', content: 'thanks' } });
      expect(await hook('UserPromptSubmit', { prompt: 'thanks' })).toContain('"ack"');
      expect(await readings(), 'turn 2 reached no hook; turn 1 did, before the restart').toEqual(['hooks not reaching DeepBuild']);
    });
  }, 30_000);
});

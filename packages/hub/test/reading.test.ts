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
function session(root: string, home: string, seq: (n: number) => string, id = SESSION, tag = 'PRE') {
  const project = join(home, '.claude', 'projects', 'tmp');
  mkdirSync(project, { recursive: true });
  const transcript = join(project, `${id}.jsonl`);
  writeFileSync(transcript, '');
  let n = 0;
  return {
    line: (o: unknown) => appendFileSync(transcript, `${JSON.stringify(o)}\n`),
    /** Sends a hook and waits until its event is in the record: the hub acknowledges before it reads the transcript. */
    hook: async (event: string, extra: Record<string, unknown> = {}) => {
      n++;
      const hookId = `01K74FKZVKZGATTBZAEG${tag}${String(n).padStart(3, '0')}`;
      const payload = { session_id: id, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra };
      const ack = await send(join(root, 'hub.sock'), hookLine(hookId, event, payload, { seq: seq(n), ppid: process.pid }));
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        for (const until = Date.now() + 3000; Date.now() < until && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(hookId); await new Promise((r) => setTimeout(r, 10)));
      } finally {
        db.close();
      }
      return ack;
    },
    /** The readings, once there are any, and after a second more, so one recorded twice shows. */
    readings: async () => {
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const read = () => (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading' AND session_id = ?").all(id) as { r: string }[]).map((x) => x.r);
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
    await withHub(async (root, home, { restart }) => {
      const now = () => String(BigInt(Date.now()) * 1_000_000n);
      const { line, hook, readings } = session(root, home, now);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // 64 more sessions start after it.
      for (let i = 0; i < 64; i++) {
        const other = session(root, home, now, `7a2d3c0f-2222-4333-8444-5555666${String(i).padStart(5, '0')}`, `S${String(i).padStart(2, '0')}`);
        expect(await other.hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      }
      // Turn 1's call reached the hub, and 70 calls after it no turn shows (a subagent's); the hub stops before the turn ends.
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      expect(await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_t1' })).toContain('"ack"');
      for (let i = 0; i < 70; i++) expect(await hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/tmp/x' }, tool_use_id: `toolu_sub${i}` })).toContain('"ack"');
      await restart();
      // While it restarts, turn 1 ends and turn 2 runs a call whose hook never reached it; turn 3's prompt ends turn 2.
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'show the status' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t2', name: 'Bash', input: { command: 'git status' } }] } });
      line({ type: 'user', uuid: 'turn-3', message: { role: 'user', content: 'thanks' } });
      expect(await hook('UserPromptSubmit', { prompt: 'thanks' })).toContain('"ack"');
      expect(await readings(), 'turn 2 reached no hook; turn 1 did, before the restart').toEqual(['hooks not reaching DeepBuild']);
    });
  }, 30_000);

  it('keeps a call reached only once its hook\'s event is durable', async () => {
    await withHub(async (root, home, { restart, exited }) => {
      const now = () => String(BigInt(Date.now()) * 1_000_000n);
      const { line, hook, readings } = session(root, home, now);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // The hub acknowledges turn 1's call and dies before its event is in the record.
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      expect(await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_t1' })).toContain('"ack"');
      await exited();
      await restart();
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'thanks' } });
      expect(await hook('UserPromptSubmit', { prompt: 'thanks' })).toContain('"ack"');
      expect(await readings(), 'turn 1\'s hook never reached the record').toEqual(['hooks not reaching DeepBuild']);
    }, { DEEP_HUB_TEST_CRASH: 'before:tool.before' });
  }, 30_000);

  it('judges a turn again after a restart when its reading never reached the record', async () => {
    await withHub(async (root, home, { restart, exited }) => {
      const now = () => String(BigInt(Date.now()) * 1_000_000n);
      const { line, hook, readings } = session(root, home, now);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // Turn 1's call reached no hook; turn 2's prompt ends it, and the hub dies appending its reading.
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'thanks' } });
      expect(await hook('UserPromptSubmit', { prompt: 'thanks' })).toContain('"ack"');
      await exited();
      await restart();
      expect(await hook('UserPromptSubmit', { prompt: 'again' })).toContain('"ack"');
      expect(await readings(), 'turn 1 reached no hook, and its reading was lost with the hub').toEqual(['hooks not reaching DeepBuild']);
    }, { DEEP_HUB_TEST_CRASH: 'before:session.reading' });
  }, 30_000);

  it('waits for a call\'s event that commits after the grace before it judges the turn', async () => {
    await withHub(async (root, home) => {
      const now = () => String(BigInt(Date.now()) * 1_000_000n);
      const { line, hook, readings } = session(root, home, now);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // Turn 1's call reaches the hub, whose append of its event takes longer than the grace; turn 2's prompt ends turn 1.
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'thanks' } });
      expect(await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_t1' })).toContain('"ack"');
      expect(await readings(), 'turn 1\'s call reached the hub').toEqual([]);
    }, { DEEP_HUB_TEST_CRASH: 'slow:tool.before' });
  }, 30_000);

  it('keeps a turn\'s reached call however many calls no turn holds come after it', async () => {
    await withHub(async (root, home) => {
      const now = () => String(BigInt(Date.now()) * 1_000_000n);
      const { line, hook, readings } = session(root, home, now);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      expect(await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_t1' })).toContain('"ack"');
      // More than the hub keeps of calls no turn holds (a subagent's) reach it, and are recorded, before turn 1 ends.
      const socket = join(root, 'hub.sock');
      for (let batch = 0; batch < 101; batch++) {
        await Promise.all(Array.from({ length: 100 }, (_, i) => {
          const n = batch * 100 + i;
          const id = `01K74FKZVKZGATTBZAE${String(n).padStart(7, '0')}`;
          return send(socket, hookLine(id, 'PreToolUse', { session_id: SESSION, cwd: '/tmp', transcript_path: join(home, '.claude', 'projects', 'tmp', `${SESSION}.jsonl`), hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/x' }, tool_use_id: `toolu_sub${n}` }, { ppid: process.pid }));
        }));
      }
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const calls = () => (db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'tool.before'").get() as { n: number }).n;
      try {
        for (const until = Date.now() + 120_000; Date.now() < until && calls() < 10_101; await new Promise((r) => setTimeout(r, 100)));
        expect(calls(), 'every call is recorded before turn 1 ends').toBe(10_101);
      } finally {
        db.close();
      }
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'thanks' } });
      expect(await hook('UserPromptSubmit', { prompt: 'thanks' })).toContain('"ack"');
      expect(await readings(), 'turn 1\'s call reached the hub').toEqual([]);
    });
  }, 240_000);

  it('judges a turn that more than a read step of transcript follows', async () => {
    await withHub(async (root, home) => {
      const now = () => String(BigInt(Date.now()) * 1_000_000n);
      const { line, hook, readings } = session(root, home, now);
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      // Turn 1's call reached no hook, and its results run to 70 MiB before turn 2's prompt ends it.
      line({ type: 'user', uuid: 'turn-1', message: { role: 'user', content: 'list the files' } });
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }] } });
      const output = 'x'.repeat(1024 * 1024);
      for (let i = 0; i < 70; i++) line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_t1', content: output }] } });
      line({ type: 'user', uuid: 'turn-2', message: { role: 'user', content: 'thanks' } });
      expect(await hook('UserPromptSubmit', { prompt: 'thanks' })).toContain('"ack"');
      expect(await readings(), 'turn 1 reached no hook').toEqual(['hooks not reaching DeepBuild']);
    });
  }, 60_000);
});

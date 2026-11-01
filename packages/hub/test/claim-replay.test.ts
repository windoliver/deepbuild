// A deep_claim that follows a PostToolUse deep-hook spooled late (its acknowledgement missed the 50 ms, so the hub
// meets the call at the replay the next hook starts) is recorded after that call, as the agent saw them: the claim
// comes after the work it claims, and the stop keeps the claim instead of reading the edit as work since it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, mcp, recorded, reply, send, withHub } from './hub.js';

describe('a deep_claim right after a late-spooled PostToolUse', () => {
  it('is recorded after the replayed call, so the stop keeps the claim: one claim.made, the call before it', async () => {
    const session = '9e2b3c4d-1111-4222-8333-444455556666';
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${session}.jsonl`);
      writeFileSync(transcript, '');
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      const line = (event: string, extra: Record<string, unknown>, more: Record<string, unknown> = {}) => hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: process.pid, ...more });
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), line(event, extra));
      await hook('SessionStart', { source: 'startup' });
      writeFileSync(transcript, `${JSON.stringify({ type: 'user', promptId: 'p1', sessionId: session, message: { role: 'user', content: 'Fix the header test.' }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' })}\n`, { flag: 'a' });
      await hook('UserPromptSubmit', { prompt: 'Fix the header test.', prompt_id: 'p1' });
      const edit = { tool_name: 'Edit', tool_input: { file_path: join(work, 'header.test.ts'), old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_1' };
      await hook('PreToolUse', edit);
      // The edit's PostToolUse never reached the hub live: deep-hook spooled it late. The next hook starts its replay.
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), line('PostToolUse', { ...edit, tool_response: { filePath: join(work, 'header.test.ts') } }, { late: true }), { mode: 0o600 });
      const args = { task_ref: 'task:01K74G0A1B2C3D4E5F6G7H8J9K', attempt: 1, commit: '0'.repeat(40), scope: 'session', predictions: null };
      await hook('PreToolUse', { tool_name: 'mcp__deep__deep_claim', tool_input: args, tool_use_id: 'toolu_2' });
      const client = mcp(home, work, false);
      try {
        await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
        const claimed = await client.call('deep_claim', args);
        expect(claimed.isError, JSON.stringify(claimed.value)).toBe(false);
        const handle = /claim:([0-9A-Z]{26})/.exec(JSON.stringify(claimed.value))?.[1];
        expect(handle, 'deep_claim answers with the claim\'s handle').toBeDefined();
        // The stop comes once the replayed call is in the record and the hub has read the turn as work to hold the stop for.
        expect(await recorded(root, session, 'tool.after', 1), 'the spooled call was replayed').toBe(1);
        await new Promise((r) => setTimeout(r, 300));
        const stopped = await reply(join(root, 'hub.sock'), line('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' }));
        expect(stopped.stdout, 'the stop is judged and carries the line').toMatch(/"systemMessage":"says done/);
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          const rows = db.prepare("SELECT id, kind, log_pos FROM events WHERE session_id = ? AND kind IN ('claim.made', 'tool.after') ORDER BY log_pos").all(session) as { id: string; kind: string; log_pos: number }[];
          expect(rows.filter((r) => r.kind === 'claim.made').map((r) => r.id), 'the turn\'s one claim is the deep_claim\'s: the stop made none').toEqual([handle]);
          const call = rows.find((r) => r.kind === 'tool.after');
          const claim = rows.find((r) => r.kind === 'claim.made');
          expect(call && claim && call.log_pos < claim.log_pos, `the replayed call is in the record before the claim: ${JSON.stringify(rows)}`).toBe(true);
        } finally {
          db.close();
        }
      } finally {
        client.close();
      }
    });
  }, 60_000);
});

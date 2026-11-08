// A deep mcp bound to a session `/clear` rotated binds each later call by its own stamp (#1632), even once the hub has
// forgotten the cleared session past the ended sessions it keeps (#824): the record still says how it ended and its thread.
// A cleared session resumed in another Claude Code process is that process's: the old process's deep mcp never acts for it.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, mcp, send, withHub } from './hub.js';

describe('a deep mcp whose session /clear rotated', () => {
  it('binds a stamped call to the new session after 64 more sessions ended and the old one left memory', async () => {
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const hook = (session: string, event: string, extra: Record<string, unknown> = {}) => {
        const transcript = join(projects, `${session}.jsonl`);
        writeFileSync(transcript, '', { flag: 'a' });
        return send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid: process.pid }));
      };
      const id = (n: number) => `1632aaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const [a, b] = [id(1), id(2)];
      await hook(a, 'SessionStart', { source: 'startup' });
      const client = mcp(home, work, false);
      try {
        await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
        expect((await client.call('deep_status', {})).value?.session, 'the deep mcp binds to A at its hello').toBe(a);
        await hook(a, 'SessionEnd', { reason: 'clear' });
        await hook(b, 'SessionStart', { source: 'clear' });
        // 64 more sessions end, each on a thread of its own: A is past the ones the hub keeps.
        for (let n = 3; n < 3 + 65; n++) {
          await hook(id(n), 'SessionStart', { source: 'startup' });
          await hook(id(n), 'SessionEnd', { reason: 'other' });
        }
        const args = { task_ref: 'task:01K74G0A1B2C3D4E5F6G7H8J9K', attempt: 1, commit: '0'.repeat(40), scope: 'session', predictions: null };
        await hook(b, 'PreToolUse', { tool_name: 'mcp__deep__deep_claim', tool_input: args, tool_use_id: 'toolu_1' });
        const claimed = await client.call('deep_claim', args);
        expect(claimed.isError, JSON.stringify(claimed.value)).toBe(false);
        await new Promise((r) => setTimeout(r, 300));
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          expect(db.prepare("SELECT session_id FROM events WHERE kind = 'claim.made'").all().map((r) => r.session_id), 'the claim is B\'s').toEqual([b]);
        } finally {
          db.close();
        }
      } finally {
        client.close();
      }
    });
  }, 120_000);

  it('never acts for the cleared session once it is resumed in another process: a call binds by its stamp or not at all', async () => {
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const hook = (session: string, event: string, extra: Record<string, unknown> = {}, ppid = process.pid) => {
        const transcript = join(projects, `${session}.jsonl`);
        writeFileSync(transcript, '', { flag: 'a' });
        return send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid }));
      };
      const [a, b] = ['1632bbbb-0000-4000-8000-000000000001', '1632bbbb-0000-4000-8000-000000000002'];
      await hook(a, 'SessionStart', { source: 'startup' });
      const client = mcp(home, work, false);
      // `claude --resume <A>` in a new process, as ps shows it: its native binary's name.
      const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { argv0: join(home, 'versions', 'claude'), stdio: 'ignore' });
      try {
        await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
        expect((await client.call('deep_status', {})).value?.session, 'the deep mcp binds to A at its hello').toBe(a);
        await hook(a, 'SessionEnd', { reason: 'clear' });
        await hook(b, 'SessionStart', { source: 'clear' });
        await hook(a, 'SessionStart', { source: 'resume' }, other.pid);
        const claim = (n: number) => ({ task_ref: `task:01K74G0A1B2C3D4E5F6G7H8J${n}K`, attempt: 1, commit: '0'.repeat(40), scope: 'session', predictions: null });
        const unstamped = await client.call('deep_claim', claim(1));
        expect(unstamped.isError, `an unstamped call is refused, not A's now that A runs in another process: ${JSON.stringify(unstamped.value)}`).toBe(true);
        await hook(b, 'PreToolUse', { tool_name: 'mcp__deep__deep_claim', tool_input: claim(2), tool_use_id: 'toolu_2' });
        const stamped = await client.call('deep_claim', claim(2));
        expect(stamped.isError, JSON.stringify(stamped.value)).toBe(false);
        await new Promise((r) => setTimeout(r, 300));
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          expect(db.prepare("SELECT session_id FROM events WHERE kind = 'claim.made'").all().map((r) => r.session_id), 'the one claim is B\'s').toEqual([b]);
        } finally {
          db.close();
        }
      } finally {
        other.kill();
        client.close();
      }
    });
  }, 60_000);

  it('refuses, naming it, a call for its session once that session ended with no successor here and was resumed in another process', async () => {
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const hook = (session: string, event: string, extra: Record<string, unknown> = {}, ppid = process.pid) => {
        const transcript = join(projects, `${session}.jsonl`);
        writeFileSync(transcript, '', { flag: 'a' });
        return send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid }));
      };
      const a = '1632cccc-0000-4000-8000-000000000001';
      await hook(a, 'SessionStart', { source: 'startup' });
      const client = mcp(home, work, false);
      const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { argv0: join(home, 'versions', 'claude'), stdio: 'ignore' });
      try {
        await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
        expect((await client.call('deep_status', {})).value?.session, 'the deep mcp binds to A at its hello').toBe(a);
        // An in-process `/resume` of another session ends A, not by `clear`; then `claude --resume <A>` takes A into another process.
        await hook(a, 'SessionEnd', { reason: 'resume' });
        await hook(a, 'SessionStart', { source: 'resume' }, other.pid);
        const args = { task_ref: 'task:01K74G0A1B2C3D4E5F6G7H8J9K', attempt: 1, commit: '0'.repeat(40), scope: 'session', predictions: null };
        const refused = await client.call('deep_claim', args);
        expect(refused.isError, `A runs in another process now: ${JSON.stringify(refused.value)}`).toBe(true);
        expect(refused.value?.code).toBe('unbound');
        expect(String(refused.value?.remediation), 'the refusal names A').toContain(a);
        await new Promise((r) => setTimeout(r, 300));
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          expect(db.prepare("SELECT session_id FROM events WHERE kind = 'claim.made'").all(), 'nothing is claimed for A').toEqual([]);
        } finally {
          db.close();
        }
      } finally {
        other.kill();
        client.close();
      }
    });
  }, 60_000);
});

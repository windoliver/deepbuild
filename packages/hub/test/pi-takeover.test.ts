// pi resumes a session from a new process, and only pi: a hook line that calls itself pi takes over no other agent's.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, reply, session, withHub } from './hub.js';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

it('takes over no Claude Code session whose process has gone', async () => {
  const id = '6b3c4d50-1111-4222-8333-444455559999';
  await withHub(async (root, home) => {
    const { work, transcript } = session(home, id);
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const payload = { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: 'SessionStart', source: 'startup' };
    await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', payload, { ppid: claude.pid }));
    claude.kill('SIGKILL');
    await sleep(500);
    await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'session_start', { ...payload, hook_event_name: 'session_start', source: 'resume' }, { agent: 'pi', ppid: process.pid }));
    await sleep(500);
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try {
      const rows = db.prepare("SELECT unverified FROM events WHERE kind = 'session.start' ORDER BY log_pos").all() as { unverified: number }[];
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.at(-1)!.unverified, 'told apart from what the session itself recorded').toBe(1);
    } finally { db.close(); }
  });
}, 60_000);

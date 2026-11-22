// A session's end copies its transcript from the path its hook named (#2316), on a hub hook requests reach the way
// deep-hook sends them. The agent's projects folder can be passed through but not listed, so only the named path
// reaches the transcript: the hub's own pass, which lists folders, copies nothing there.
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hookLine, send, session, withHub } from './hub.js';

const ID = 'aaaaaaaa-2316-4000-8000-000000000001';

describe('a session that ends', () => {
  it("has its transcript copied from the path its hook named, under a folder the archive can't list", async () => {
    await withHub(async (root, home) => {
      const s = session(home, ID);
      writeFileSync(s.transcript, `${JSON.stringify({ type: 'user', uuid: 'm1', cwd: s.work, message: { role: 'user', content: 'fix the checkout total' } })}\n`);
      const projects = dirname(dirname(s.transcript));
      const sock = join(root, 'hub.sock');
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const copied = () => (db.prepare("SELECT json_extract(data, '$.session') AS s FROM events WHERE kind = 'transcript.archived'").all() as { s: string }[]).map((r) => r.s);
      chmodSync(projects, 0o311);
      try {
        await send(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T70', 'SessionStart', s.payload('SessionStart', { source: 'startup' }), { ppid: process.pid }));
        await send(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T71', 'SessionEnd', s.payload('SessionEnd', { reason: 'other' }), { ppid: process.pid }));
        for (const until = Date.now() + 15_000; Date.now() < until && !copied().length; await new Promise((r) => setTimeout(r, 100)));
        expect(copied(), "the session's end copied the transcript at its hook's transcript_path").toEqual([`session:${ID.replace(/-/g, '')}`]);
      } finally {
        chmodSync(projects, 0o755);
        db.close();
      }
    });
  }, 60_000);
});

// The sessions the hub forgot (#1866): a pass over every session compares each with the state the record holds, so
// none of them is recorded again while nothing about it changed.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { client, hookLine, recorded, send, withHub } from './hub.js';

/** Past the 64 ended sessions the hub keeps in memory. */
const SESSIONS = 72;

it("a pass over every session records no state of one the hub forgot, and its row stays the record's", async () => {
  await withHub(async (root, home) => {
    const socket = join(root, 'hub.sock');
    const id = () => `0${randomUUID().replace(/-/g, '').toUpperCase().slice(0, 25)}`;
    const sessions = Array.from({ length: SESSIONS }, () => randomUUID());
    for (const session of sessions) {
      const hook = (event: string, payload: Record<string, unknown>) => send(socket, hookLine(id(), event, { session_id: session, cwd: home, hook_event_name: event, ...payload }));
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'say what the value is' });
      await hook('Stop', { stop_hook_active: false, last_assistant_message: 'The value is 4.' });
      await hook('SessionEnd', { reason: 'other' });
    }
    for (let n = 0; n < 9 && !(await recorded(root, sessions.at(-1)!, 'session.end', 1)); n++);
    expect(await recorded(root, sessions.at(-1)!, 'session.end', 1), 'every hook is in the record').toBe(1);
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try {
      const last = () => (db.prepare('SELECT max(log_pos) AS pos FROM events').get() as { pos: number }).pos;
      const quiet = async () => {
        for (let pos = last(), still = 0; still < 6;) {
          await new Promise((r) => setTimeout(r, 200)); // deadline: the record takes nothing for six of these, well past a pass's 200 ms
          const now = last();
          still = now === pos ? still + 1 : 0;
          pos = now;
        }
      };
      await quiet();
      expect(db.prepare("SELECT count(DISTINCT session_id) AS n FROM events WHERE kind = 'session.state'").get(), 'every session had a state').toEqual({ n: SESSIONS });
      const rows = () => db.prepare("SELECT id, row FROM rows WHERE id LIKE 'session:%' ORDER BY id").all();
      const before = { pos: last(), rows: rows() };
      // An append of no session's own has the next pass read every session.
      const cli = await client(socket, readFileSync(join(root, 'control.token'), 'utf8').trim());
      for (let n = 0; n < 3; n++) {
        await cli('setup.report', { steps: [{ step: 'install', agent: 'claude-code' }] });
        await quiet();
      }
      expect(last(), 'an append of no session\'s own').toBeGreaterThan(before.pos);
      expect(db.prepare("SELECT session_id, count(*) AS n FROM events WHERE kind = 'session.state' AND log_pos > ? GROUP BY session_id").all(before.pos)).toEqual([]);
      expect(rows()).toEqual(before.rows);
    } finally { db.close(); }
  });
}, 120_000);

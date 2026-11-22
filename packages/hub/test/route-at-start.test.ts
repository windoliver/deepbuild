// A session's route is read once at its start (#1886): from the variables its SessionStart reports set, through its
// adapter's routeAtStart, onto the session.start the record keeps, true or false and never a value. The hub is real,
// on a temp home, and each request is the line deep-hook sends.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, recorded, send, session, withHub } from './hub.js';

const PROXIED = '3b9f1c2e-1886-4222-8333-44445555aaaa';
const OWN = '3b9f1c2e-1886-4222-8333-44445555bbbb';

describe('the route a session started on', () => {
  it('is recorded on its session.start from what its SessionStart reports set, through its adapter', async () => {
    await withHub(async (root, home) => {
      const start = async (id: string, route: Record<string, boolean>) => {
        const s = session(home, id);
        const line = hookLine(ulid(Date.now()), 'SessionStart', s.payload('SessionStart', { source: 'startup' }), {
          ppid: process.pid, billing: { ANTHROPIC_API_KEY: false, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false, OPENAI_API_KEY: false }, route,
        });
        expect(await send(join(root, 'hub.sock'), line)).toContain('"ack"');
        expect(await recorded(root, id, 'session.start', 1), `the session.start of ${id} is recorded`).toBe(1);
      };
      await start(PROXIED, { ANTHROPIC_BASE_URL: true, OPENAI_BASE_URL: false });
      await start(OWN, { ANTHROPIC_BASE_URL: false, OPENAI_BASE_URL: false });
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        const routeOf = (id: string): unknown => JSON.parse((db.prepare("SELECT data FROM events WHERE kind = 'session.start' AND session_id = ?").get(id) as { data: string }).data).route;
        expect(routeOf(PROXIED), 'Claude Code\'s route behind a base URL').toEqual({ ANTHROPIC_BASE_URL: true, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false });
        expect(routeOf(OWN), 'Claude Code\'s own route').toEqual({ ANTHROPIC_BASE_URL: false, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false });
      } finally {
        db.close();
      }
    });
  }, 60_000);
});

// A session's route is read once at its start (#1886): from the variables its SessionStart reports set, through its
// adapter's routeAtStart, onto the session.start the record keeps, true or false and never a value. The hub is real,
// on a temp home, and each request is the line deep-hook sends.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, recorded, send, session, withHub } from './hub.js';

const PROXIED = '3b9f1c2e-1886-4222-8333-44445555aaaa';
const OWN = '3b9f1c2e-1886-4222-8333-44445555bbbb';
const CODEX = '01a15756-1886-7910-90bb-db79d3fddb7a';
const LITERAL = '01a15756-1886-7910-90bb-db79d3fddb7b';
const UNREPORTED = '3b9f1c2e-1886-4222-8333-44445555cccc';

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
      // Codex sessions whose home, the folder its rollout sits under, sets a model provider other than OpenAI's, in a
      // basic and in a literal TOML string.
      const codex = async (id: string, folder: string, provider: string) => {
        const codexHome = join(home, folder);
        const day = join(codexHome, 'sessions', '2026', '11', '22');
        mkdirSync(day, { recursive: true });
        writeFileSync(join(codexHome, 'config.toml'), `model = "gpt-5-codex"\nmodel_provider = ${provider}\n`);
        const rollout = join(day, `rollout-2026-11-22T02-00-00-${id}.jsonl`);
        writeFileSync(rollout, '');
        mkdirSync(join(home, 'work'), { recursive: true });
        const line = hookLine(ulid(Date.now()), 'SessionStart', { session_id: id, transcript_path: rollout, cwd: join(home, 'work'), hook_event_name: 'SessionStart', model: 'gpt-5-codex', permission_mode: 'default', source: 'startup' }, {
          agent: 'codex', ppid: process.pid, billing: { OPENAI_API_KEY: false }, route: { ANTHROPIC_BASE_URL: false, OPENAI_BASE_URL: false },
        });
        expect(await send(join(root, 'hub.sock'), line)).toContain('"ack"');
        expect(await recorded(root, id, 'session.start', 1), `the Codex session.start of ${id} is recorded`).toBe(1);
      };
      await codex(CODEX, '.codex-work', '"ollama"');
      await codex(LITERAL, '.codex-literal', "'ollama'");
      // A start whose line reports no route, as an older deep-hook sends it: the record keeps none, never "own route".
      const old = session(home, UNREPORTED);
      expect(await send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', old.payload('SessionStart', { source: 'startup' }), { ppid: process.pid, billing: { ANTHROPIC_API_KEY: false } }))).toContain('"ack"');
      expect(await recorded(root, UNREPORTED, 'session.start', 1), 'the unreported session.start is recorded').toBe(1);
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        const routeOf = (id: string): unknown => JSON.parse((db.prepare("SELECT data FROM events WHERE kind = 'session.start' AND session_id = ?").get(id) as { data: string }).data).route;
        expect(routeOf(PROXIED), 'Claude Code\'s route behind a base URL').toEqual({ ANTHROPIC_BASE_URL: true, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false });
        expect(routeOf(CODEX), 'Codex\'s route on its home\'s model provider').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(LITERAL), 'Codex\'s route on a provider named in a literal string').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(UNREPORTED), 'a start that reported no route').toBeUndefined();
        expect(routeOf(OWN), 'Claude Code\'s own route').toEqual({ ANTHROPIC_BASE_URL: false, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false });
      } finally {
        db.close();
      }
    });
  }, 60_000);
});

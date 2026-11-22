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
const QUOTED = '01a15756-1886-7910-90bb-db79d3fddb7c';
const PROFILE = '01a15756-1886-7910-90bb-db79d3fddb7d';
const OPENAI = '01a15756-1886-7910-90bb-db79d3fddb7e';
const NO_CONFIG = '01a15756-1886-7910-90bb-db79d3fddb7f';
const AFTER_ARRAY = '01a15756-1886-7910-90bb-db79d3fddb80';
const BASE_URL = '01a15756-1886-7910-90bb-db79d3fddb81';
const TYPICAL = '01a15756-1886-7910-90bb-db79d3fddb82';
const MOVED = ['chatgpt_base_url = "http://127.0.0.1:9"\n', 'oss_provider = "ollama"\n', 'model_provider = "openai"\nmodel_provider = "ollama"\n', '[tui]\nmodel_provider = "ollama"\n', 'profile = "work"\n', '[profiles.work]\nmodel = "o3"\n', 'openai_base_url = "http://127.0.0.1:9/v1"\n', 'model_providers.local.base_url = "http://127.0.0.1:9/v1"\n'].map((config, i) => ({ id: `01a15756-1886-7910-90bb-db79d3fddc${String(i).padStart(2, '0')}`, config }));
const UNREADABLE = '01a15756-1886-7910-90bb-db79d3fddb83';
const UNREPORTED = '3b9f1c2e-1886-4222-8333-44445555cccc';
const GATEWAYS = ['ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_AWS_BASE_URL', 'ANTHROPIC_BEDROCK_MANTLE_BASE_URL', 'ANTHROPIC_GOOGLE_CLOUD_BASE_URL'].map((key, i) => ({ id: `3b9f1c2e-1886-4222-8333-44445555dd${String(i).padStart(2, '0')}`, key }));
const NAMED_HOME = '01a15756-1886-7910-90bb-db79d3fddb85';
const NO_ROLLOUT = '01a15756-1886-7910-90bb-db79d3fddb84';

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
      // A base URL for any of Claude Code's other providers, each alone: its endpoint's word is the proxy's, as Anthropic's is.
      for (const g of GATEWAYS) await start(g.id, { ANTHROPIC_BASE_URL: false, [g.key]: true, OPENAI_BASE_URL: false });
      // Codex sessions whose home, the folder its rollout sits under, sets a model provider other than OpenAI's, in a
      // basic and in a literal TOML string, and under a quoted key.
      const codex = async (id: string, folder: string, config: string | null, rolloutAt?: string, route: Record<string, boolean> = {}) => {
        const codexHome = join(home, folder);
        const day = rolloutAt ?? join(codexHome, 'sessions', '2026', '11', '22');
        mkdirSync(day, { recursive: true });
        mkdirSync(codexHome, { recursive: true });
        if (config !== null) writeFileSync(join(codexHome, 'config.toml'), `model = "gpt-5-codex"\n${config}`);
        const rollout = join(day, `rollout-2026-11-22T02-00-00-${id}.jsonl`);
        writeFileSync(rollout, '');
        mkdirSync(join(home, 'work'), { recursive: true });
        const line = hookLine(ulid(Date.now()), 'SessionStart', { session_id: id, transcript_path: rollout, cwd: join(home, 'work'), hook_event_name: 'SessionStart', model: 'gpt-5-codex', permission_mode: 'default', source: 'startup' }, {
          agent: 'codex', ppid: process.pid, billing: { OPENAI_API_KEY: false }, route: { ANTHROPIC_BASE_URL: false, OPENAI_BASE_URL: false, ...route },
        });
        expect(await send(join(root, 'hub.sock'), line)).toContain('"ack"');
        expect(await recorded(root, id, 'session.start', 1), `the Codex session.start of ${id} is recorded`).toBe(1);
      };
      await codex(CODEX, '.codex-work', 'model_provider = "ollama"\n');
      await codex(LITERAL, '.codex-literal', "model_provider = 'ollama'\n");
      await codex(QUOTED, '.codex-quoted', '"model_provider" = "ollama"\n');
      // A provider a profile names: the first profile's says OpenAI's, the selected one's doesn't.
      await codex(PROFILE, '.codex-profile', 'profile = "work"\n\n[profiles.a]\nmodel_provider = "openai"\n\n[profiles.work]\nmodel_provider = "ollama"\n');
      // Codex's own route: OpenAI's provider beside a table of other settings, and no config at all.
      await codex(OPENAI, '.codex-openai', 'model_provider = "openai"\n\n[tui]\nnotifications = true\n');
      await codex(NO_CONFIG, '.codex-none', null);
      // A provider after a value whose lines start with a bracket, and OpenAI's own base URL moved by a provider table.
      await codex(AFTER_ARRAY, '.codex-array', 'notify = [\n  ["say", "done"],\n]\nmodel_provider = "ollama"\n');
      await codex(BASE_URL, '.codex-base', '[model_providers.openai]\nbase_url = "http://127.0.0.1:9/v1"\n');
      // Each other key or line that may move the route, on its own.
      for (const [i, m] of MOVED.entries()) await codex(m.id, `.codex-moved-${i}`, m.config);
      // A config that can't be read is no word for the default provider.
      mkdirSync(join(home, '.codex-unreadable', 'config.toml'), { recursive: true });
      await codex(UNREADABLE, '.codex-unreadable', null);
      // A start whose rollout names no Codex home: the hub's own home, on OpenAI's provider here, is no word for the
      // agent's, which may sit elsewhere.
      await codex(NO_ROLLOUT, '.codex', 'model_provider = "openai"\n', join(home, 'elsewhere'));
      // A reported key never names the home: a line that says CODEX_HOME is set still has no home its rollout names.
      await codex(NAMED_HOME, '.codex', 'model_provider = "openai"\n', join(home, 'elsewhere'), { CODEX_HOME: true, HOME: true });
      // An ordinary config on OpenAI's provider: its tables move nothing.
      await codex(TYPICAL, '.codex-typical', 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n\n[tui]\nnotifications = true\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp"]\n\n[projects."/work"]\ntrust_level = "trusted"\n\n[history]\npersistence = "save-all"\n');
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
        expect(routeOf(QUOTED), 'Codex\'s route on a provider under a quoted key').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(PROFILE), 'Codex\'s route on a provider its selected profile names').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(OPENAI), 'Codex\'s own provider').toEqual({ OPENAI_BASE_URL: false, model_provider: false });
        expect(routeOf(NO_CONFIG), 'Codex with no config').toEqual({ OPENAI_BASE_URL: false, model_provider: false });
        expect(routeOf(AFTER_ARRAY), 'Codex\'s route on a provider after a bracketed value').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(BASE_URL), 'Codex\'s route on OpenAI\'s provider at another base URL').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        for (const m of MOVED) expect(routeOf(m.id), `Codex's route under ${JSON.stringify(m.config)}`).toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(UNREADABLE), 'Codex\'s route on a config it can\'t read').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(TYPICAL), 'Codex\'s own route under an ordinary config').toEqual({ OPENAI_BASE_URL: false, model_provider: false });
        expect(routeOf(NO_ROLLOUT), 'Codex\'s route with no home its rollout names').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        for (const g of GATEWAYS) expect(routeOf(g.id), `Claude Code's route behind ${g.key}`).toEqual({ ANTHROPIC_BASE_URL: true, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false });
        expect(routeOf(NAMED_HOME), 'Codex\'s route when a reported key names CODEX_HOME').toEqual({ OPENAI_BASE_URL: false, model_provider: true });
        expect(routeOf(UNREPORTED), 'a start that reported no route').toBeUndefined();
        expect(routeOf(OWN), 'Claude Code\'s own route').toEqual({ ANTHROPIC_BASE_URL: false, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false });
      } finally {
        db.close();
      }
    });
  }, 60_000);
});

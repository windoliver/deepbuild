// #824: deep-hook's deep-actions server, which `deep setup` now writes, serves what `deep mcp actions` serves. Both run
// as the same agent's servers against one real hub with a plug-in installed (#363's world), and each request gets the
// same answer from both; a tool text is compared as the JSON it holds. Its data file matches the hub's tool list.
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { pkg, requestId } from '../../../tests/acceptance/363/helpers.ts';
import { hubWorld, REPO, type HubWorld, type Line } from '../../../tests/acceptance/363/hub.ts';
import { CODES } from '../src/codes.js';
import { actionToolList } from '../src/tools.js';

const HOOK = join(REPO, 'target/debug/deep-hook');
const SERVERS = { node: [process.execPath, join(REPO, 'packages/cli/dist/main.js'), 'mcp', 'actions'], rust: [HOOK, 'mcp', 'actions'] } as const;
type Side = keyof typeof SERVERS;

/** One request to this side's server, a child of the world's agent stand-in, as #363's Agent.request sends it. */
async function ask(w: HubWorld, side: Side, method: string, params?: Line, id: unknown = `${side}-${method}`): Promise<Line> {
  // The stand-in takes any server's argv; #363's Agent names only its own two, so its send is called directly.
  const send = (w.agent as unknown as { send(c: Line, ms: number): Promise<Line> }).send.bind(w.agent);
  const line = id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
  const r = await send({ op: 'mcp', server: `actions-${side}`, argv: SERVERS[side], line, timeoutMs: 90_000 }, 95_000);
  return (r.reply ?? {}) as Line;
}
/** A reply with its ID dropped and each tool text read as the JSON it holds. */
function shape(reply: Line): Line {
  const { id: _id, ...rest } = reply;
  const read = (text: unknown) => { try { return JSON.parse(String(text)); } catch { return text; } };
  const result = rest.result as Line | undefined;
  if (Array.isArray(result?.content)) result.content = result.content.map((c: Line) => ({ ...c, text: read(c.text) }));
  if (Array.isArray(result?.contents)) result.contents = result.contents.map((c: Line) => ({ ...c, text: read(c.text) }));
  return rest;
}

let w: HubWorld;
beforeAll(async () => {
  if (!existsSync(HOOK)) throw Error(`BLOCKED: build deep-hook first (cargo build -p deep-hook): ${HOOK}`);
  w = await hubWorld([await pkg('rules', { probe: { case: 'fixed' } })]);
  for (const side of ['node', 'rust'] as const) {
    await ask(w, side, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'actions-server', version: '0' } });
    await ask(w, side, 'notifications/initialized', {}, undefined);
  }
}, 240_000);

describe('deep-hook mcp actions answers as deep mcp actions does', () => {
  it('its data file is the hub\'s action tools and codes', () => {
    const file = JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/src/actions.json'), 'utf8'));
    expect(file, 'run node scripts/actions-server.mjs after building the hub, and rebuild deep-hook').toEqual({ tools: actionToolList(), codes: CODES });
  });

  it.each([
    ['initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'again', version: '0' } }],
    ['ping', {}],
    ['tools/list', {}],
    ['resources/list', {}],
    ['resources/read', { uri: 'deep://codes/required' }],
    ['resources/read', { uri: 'deep://codes/nothing' }],
    ['tools/call', { name: 'no_such_tool', arguments: {} }],
    ['tools/call', { name: 'find_actions', arguments: { query: null } }],
    ['tools/call', { name: 'find_actions', arguments: { query: 'rules', extra: 1 } }],
    ['no/such/method', {}],
  ] as const)('%s %j', async (method, params) => {
    const [node, rust] = await Promise.all([ask(w, 'node', method, params), ask(w, 'rust', method, params)]);
    expect('result' in node || 'error' in node, `deep mcp actions answered: ${JSON.stringify(node)}`).toBe(true);
    expect(shape(rust)).toEqual(shape(node));
  }, 120_000);

  it('a session in a worktree sent to a dev hub (hub.use) reaches that hub, as deep mcp does', async () => {
    const file = join(w.agent.home, '.deepbuild', 'config.json');
    const kept = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    const config = kept ? JSON.parse(kept) : {};
    // The default address leads nowhere; only the worktree's entry names the hub that knows the session.
    config.hub = { ...config.hub, address: `unix:${join(w.agent.home, 'nowhere.sock')}`, use: { [realpathSync(w.session.cwd)]: `unix:${w.hub.socket}` } };
    writeFileSync(file, JSON.stringify(config));
    try {
      const r = await ask(w, 'rust', 'tools/call', { name: 'find_actions', arguments: { query: null } }, 'rust-use');
      expect(r.result?.isError, JSON.stringify(r).slice(0, 800)).toBe(false);
    } finally {
      if (kept === undefined) rmSync(file); else writeFileSync(file, kept);
    }
  }, 120_000);

  it('a plug-in action that throws is a failed call on both, not the hub unavailable', async () => {
    for (const side of ['node', 'rust'] as const) {
      const r = await ask(w, side, 'tools/call', { name: 'call_action', arguments: { action: 'ext.rules.boom', request: requestId(), input: JSON.stringify({ symbol: 'NVDA' }) } });
      expect(r.result?.isError, `${side}: ${JSON.stringify(r).slice(0, 800)}`).toBe(true);
      expect(r.result?.structuredContent, side).toMatchObject({ status: 'failed' });
    }
  }, 180_000);
});

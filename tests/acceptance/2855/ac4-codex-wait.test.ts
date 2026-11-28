import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, cleanup, codexPayload, codexThread, CODEX_COVERED, loadReading, makeWorld, MODERN, modern, pollStep, setup, startHub, tag, type Line, type Thread, type World } from './helpers.ts';

afterEach(cleanup, 60_000);

const CLIENT = 'codex-mcp-client';
const STILL_WAITING_MS = 115_000;
const choice = (question: string): Line => ({ kind: 'choice', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }] });

async function askOnce(w: World, t: Thread, how: 'initialize' | '_meta', asking: () => void = () => undefined): Promise<string | undefined> {
  const who = how === 'initialize' ? `a client that named itself ${CLIENT} at initialize` : `a client that names itself ${CLIENT} only in its requests' _meta`;
  const agent = Agent.start(w, t.cwd);
  const asSent = (params: Line): Line => (how === 'initialize' ? params : modern(params, MODERN, CLIENT));
  await agent.hook('codex', codexPayload(t, 'SessionStart'), t.cwd);
  if (how === 'initialize') {
    await agent.mcp({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CLIENT, version: CODEX_COVERED } } });
    await agent.mcp({ method: 'notifications/initialized', params: {} });
  }
  let connected = false;
  const due = Date.now() + 90_000;
  for (let i = 0; !connected && Date.now() < due; i++) {
    const { reply } = await agent.mcp({ id: 100 + i, method: 'tools/call', params: asSent({ name: 'deep_status', arguments: {} }) });
    connected = !/hub is unreachable/.test(JSON.stringify(reply));
    if (!connected) await pollStep(1000);
  }
  if (!connected) throw Error(`BLOCKED: ${who}: deep mcp never reached the hub in 90 s of deep_status calls; ${loadReading()}`);
  t.turn = crypto.randomUUID();
  await agent.hook('codex', codexPayload(t, 'UserPromptSubmit', { prompt: 'Pick a header colour.' }), t.cwd);
  const args = choice(`Which header colour, ${tag()}?`);
  await agent.hook('codex', codexPayload(t, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: `call_${tag(6)}` }), t.cwd); asking();
  const { reply, ms } = await agent.mcp({ id: 2, method: 'tools/call', params: asSent({ name: 'deep_ask', arguments: args }) }, 150_000);
  const text = JSON.stringify(reply ?? null);
  if (/still waiting/i.test(text) && ms >= STILL_WAITING_MS - 5000) return undefined;
  return `${who}: the wait for deep_ask ended after ${(ms / 1000).toFixed(1)} s with ${text.slice(0, 400)}, not the hub's "still waiting" at ${STILL_WAITING_MS / 1000} s`;
}

describe(`#2855.ed6c227c Codex's wait holds for a Codex that never sends initialize`, () => {
  it(`#2855.ed6c227c with tool_timeout_sec = 120, a deep_ask from a client named ${CLIENT} only in _meta waits for the hub's "still waiting", as one named at initialize does`, async () => {
    const w = makeWorld();
    await startHub(w);
    await setup(w);
    writeFileSync(w.configToml, '[mcp_servers.deep]\ntool_timeout_sec = 120\n');
    let asked = (): void => undefined; const asking = new Promise<void>((resolve) => { asked = resolve; });
    const named = askOnce(w, codexThread(w), 'initialize', () => asked()); await Promise.race([asking, named]);
    const failures = (await Promise.all([named, askOnce(w, codexThread(w), '_meta')])).filter((f): f is string => f !== undefined);
    expect(failures, "each client's wait for deep_ask").toEqual([]);
  }, 420_000);
});

// #2855 AC4: "With Codex's tool timeout set to 120 s, a client that names itself `codex-mcp-client` only in its
// requests' `_meta` holds a `deep_ask` until the hub's "still waiting", as one that named itself at `initialize` does.
// A planted server that reads the name only at `initialize` answers `unavailable` at 55 s and fails, naming the wait"
//
// After tests/acceptance/39's AC19 (lanes.test.ts): a hub with `deep setup` run in a scratch home with a fake codex,
// `tool_timeout_sec = 120` for DeepBuild's MCP server in Codex's config.toml, so the hub says "still waiting" at 115 s,
// 5 s before the timeout. Two Codex threads at once, each with its own agent stand-in that is the parent of its hooks
// and of its one `deep mcp`: one names itself `codex-mcp-client` at initialize (the comparison), the other sends no
// initialize and names itself only in each request's `_meta`. Each fires PreToolUse for `mcp__deep__deep_ask`, then
// calls deep_ask with a choice no one answers and that recommends nothing (one with a recommended option is answered
// provisional at once, so it never waits; packages/hub/src/mcp-operations.ts). Real time: about two minutes, the hub's 115 s and the rest (README:
// Run). Every failure line names the client and the wait.
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AC, Agent, cleanup, codexPayload, codexThread, CODEX_COVERED, loadReading, makeWorld, MODERN, modern, setup, sleep, startHub, tag, type Line, type Thread, type World } from './helpers.ts';

afterEach(cleanup, 60_000);

const CLIENT = 'codex-mcp-client';
/** The hub's "still waiting" at Codex's 120 s less its 5 s margin; a reply well before it is not the hub's. */
const STILL_WAITING_MS = 115_000;
const choice = (question: string): Line => ({ kind: 'choice', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }] });

/** One Codex thread's deep_ask: its reply's text, how long it took, and a failure line or none. */
async function askOnce(w: World, t: Thread, how: 'initialize' | '_meta'): Promise<string | undefined> {
  const who = how === 'initialize' ? `a client that named itself ${CLIENT} at initialize` : `a client that names itself ${CLIENT} only in its requests' _meta`;
  const agent = Agent.start(w, t.cwd);
  const asSent = (params: Line): Line => (how === 'initialize' ? params : modern(params, MODERN, CLIENT));
  await agent.hook('codex', codexPayload(t, 'SessionStart'), t.cwd);
  if (how === 'initialize') {
    await agent.mcp({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CLIENT, version: CODEX_COVERED } } });
    await agent.mcp({ method: 'notifications/initialized', params: {} });
  }
  // deep mcp connects to the hub at its first call and keeps the connection. Its connect has one second, which a
  // loaded machine can miss (`ps` for the parent's start runs inside it), so a deep_status opens the connection first,
  // tried for up to 90 s, a second apart; one that never connects is BLOCKED, not this criterion's failure.
  let connected = false;
  const due = Date.now() + 90_000;
  for (let i = 0; !connected && Date.now() < due; i++) {
    const { reply } = await agent.mcp({ id: 100 + i, method: 'tools/call', params: asSent({ name: 'deep_status', arguments: {} }) });
    connected = !/hub is unreachable/.test(JSON.stringify(reply));
    if (!connected) await sleep(1000);
  }
  if (!connected) throw Error(`BLOCKED: ${who}: deep mcp never reached the hub in 90 s of deep_status calls; ${loadReading()}`);
  t.turn = crypto.randomUUID();
  await agent.hook('codex', codexPayload(t, 'UserPromptSubmit', { prompt: 'Pick a header colour.' }), t.cwd);
  const args = choice(`Which header colour, ${tag()}?`);
  await agent.hook('codex', codexPayload(t, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: `call_${tag(6)}` }), t.cwd);
  const { reply, ms } = await agent.mcp({ id: 2, method: 'tools/call', params: asSent({ name: 'deep_ask', arguments: args }) }, 150_000);
  const text = JSON.stringify(reply ?? null);
  if (/still waiting/i.test(text) && ms >= STILL_WAITING_MS - 5000) return undefined;
  return `${who}: the wait for deep_ask ended after ${(ms / 1000).toFixed(1)} s with ${text.slice(0, 400)}, not the hub's "still waiting" at ${STILL_WAITING_MS / 1000} s`;
}

describe(`${AC.codexWait} Codex's wait holds for a Codex that never sends initialize`, () => {
  it(`${AC.codexWait} with tool_timeout_sec = 120, a deep_ask from a client named ${CLIENT} only in _meta waits for the hub's "still waiting", as one named at initialize does`, async () => {
    const w = makeWorld();
    await startHub(w);
    await setup(w);
    writeFileSync(w.configToml, '[mcp_servers.deep]\ntool_timeout_sec = 120\n');
    // The second thread starts 10 s after the first, so the two sessions' starts don't share the hub's first second.
    const named = askOnce(w, codexThread(w), 'initialize');
    await sleep(10_000);
    const failures = (await Promise.all([named, askOnce(w, codexThread(w), '_meta')])).filter((f): f is string => f !== undefined);
    expect(failures, "each client's wait for deep_ask").toEqual([]);
  }, 420_000);
});

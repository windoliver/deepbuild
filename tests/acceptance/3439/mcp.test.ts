// #3439 AC4 (#3439.420f3cfc): "`deep mcp` started as an agent's settings start it serves `initialize` and one tool
// call whether or not it has a collector. A planted entry that throws where the collector is missing fails, naming
// the call."
//
// The server is the one `deep setup` registered for Claude Code at user scope (<home>/.claude.json, `deepbuild`): its
// command, its arguments and its environment, as written. It runs three times against one hub: as written; given a
// collector for sure (`--expose-gc` in NODE_OPTIONS); and with every way to a collector at launch taken out (no such
// argument, no such option). The last two are read through Node's inspector, so "with" and "without" are what the
// process had, not what the test hoped it had. The tool call is `deep_status`, the one every session begins with.
import { afterEach, expect, it } from 'vitest';
import { cleanup, makeHome, newSession, setup, startHub } from '../27/helpers.ts';
import { AC, mcpServer, redact, shownThreads, startMcp, threadsOf, type Collector } from './helpers.ts';

afterEach(cleanup, 120_000);

const RUNS: { collector: Collector; what: string; has?: string }[] = [
  { collector: 'as-written', what: "as the agent's settings start it" },
  { collector: 'given', what: 'given a collector when it launched', has: 'function' },
  { collector: 'withheld', what: 'with no collector given when it launched', has: 'undefined' },
];

it(`${AC.mcp} deep mcp started as an agent's settings start it serves initialize and one tool call whether or not it has a collector`, async () => {
  const { home } = makeHome();
  await startHub(home);
  await setup(home);
  const server = mcpServer(home);
  expect(server, `${AC.mcp} deep setup registers DeepBuild's MCP server in Claude Code's user settings (~/.claude.json, mcpServers.deepbuild) with a command and its arguments`).toBeDefined();
  const s = newSession(home);

  for (const run of RUNS) {
    const mcp = startMcp(home, s.cwd, server!, run.collector);
    const told = `deep mcp ${run.what} (${mcp.command})`;
    const failed = (reply: object): string => ('failed' in reply ? String((reply as { failed: string }).failed) : `it answered ${redact(JSON.stringify(reply)).slice(0, 600)}`);

    const initialize = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3439', version: '0' } });
    expect('result' in initialize && typeof initialize.result?.serverInfo?.name === 'string', `${AC.mcp} ${told} serves the call initialize: ${failed(initialize)}`).toBe(true);
    mcp.notify('notifications/initialized');

    const call = await mcp.request('tools/call', { name: 'deep_status', arguments: {} });
    expect('result' in call && call.result?.isError === false, `${AC.mcp} ${told} serves the tool call deep_status (tools/call), with a hub answering: ${failed(call)}`).toBe(true);

    // What the process had: read after it served, so the reading can't change what was served.
    if (run.has) {
      const read = await threadsOf(mcp.pid, mcp.stderr);
      expect(read.threads[0]?.collector, `${AC.mcp} INCONCLUSIVE, not a pass: this run was to be ${told}, and its main thread reads otherwise, so "whether or not it has a collector" was not shown; ${shownThreads(read.threads)}${read.why ? `; ${read.why}` : ''}`).toBe(run.has);
    }
    // It is still serving: a second call after the collection's turn has passed.
    const again = await mcp.request('tools/call', { name: 'deep_status', arguments: {} });
    expect('result' in again && again.result?.isError === false, `${AC.mcp} ${told} goes on serving: a second deep_status (tools/call) after the first: ${failed(again)}`).toBe(true);
    mcp.end();
  }
}, 600_000);

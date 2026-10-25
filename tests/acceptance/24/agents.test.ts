// #24.4373d3bf: agents have no command or tool that can answer. An agent's commands run in its process tree, so
// `deep inbox answer` run there acts as the agent's session, never as you (design: One role per credential;
// Answers from the terminal); its MCP server, `deep mcp`, lists no tool that answers, and none of its tools
// answers whatever it is sent; and an mcp connection to the hub can't call the answer. Every case runs with the
// OS confirmation stubbed to confirm, so nothing here passes only because the confirmation was cancelled.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { Agent, cleanup, Conn, deep, expectCountedOnce, expectOpen, seed, startHub, tempDir, type Hub } from './helpers.ts';

afterAll(cleanup, 30_000);

let world: Promise<{ hub: Hub; agent: Agent; byCommand: string; byTool: string; bySocket: string }> | undefined;
const setUp = () => (world ??= (async () => {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  const agent = Agent.start(home);
  let byCommand = '';
  let byTool = '';
  let bySocket = '';
  await seed(home, async (s) => {
    await s.start(agent.session);
    byCommand = await s.raise(agent.session, 'authority', 'feature/login');
    byTool = await s.raise(agent.session, 'taste', 'the header');
    bySocket = await s.raise(agent.session, 'definition', 'offline mode');
  });
  const hub = await startHub(home, { confirm: 'confirmed' });
  await agent.establish(hub);
  return { hub, agent, byCommand, byTool, bySocket };
})());

test('#24.4373d3bf deep inbox answer run in an agent\'s process tree answers nothing; the same command run by you does', async () => {
  const { hub, agent, byCommand } = await setUp();
  const r = await agent.deep(['inbox', 'answer', byCommand, 'decline']);
  await expectOpen(hub, byCommand, 'deep inbox answer run by the agent through its own shell');
  expect(r.code, `deep inbox answer run in the agent's process tree exits 3 (not decided): ${r.stdout}${r.stderr}`).toBe(3);
  // The refusal came from the peer check, not from a hub that refuses every CLI answer.
  const mine = await deep(hub.home, ['inbox', 'answer', byCommand, 'decline']);
  expect(mine.code, `the same deep inbox answer run by you exits 0: ${mine.stdout}${mine.stderr}`).toBe(0);
  await expectCountedOnce(hub, byCommand, 'decline', 'deep inbox answer run by you');
}, 120_000);

test('#24.4373d3bf the agent\'s deep mcp lists no tool that answers, and none of its tools answers an ask', async () => {
  const { hub, agent, byTool } = await setUp();
  const init = await agent.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-stand-in', version: '0' } });
  expect(init.result, `deep mcp initializes: ${JSON.stringify(init)}`).toBeDefined();
  const list = await agent.mcp('tools/list');
  const tools = (list.result?.tools ?? []) as { name: string }[];
  expect(tools.length, `deep mcp lists its tools: ${JSON.stringify(list)}`).toBeGreaterThan(0);
  const names = tools.map((t) => t.name);
  expect(names.filter((n) => /answer|approve|respond|reply/i.test(n)), 'deep mcp lists no tool that answers an ask').toEqual([]);
  for (const name of names) await agent.mcp('tools/call', { name, arguments: { ask: byTool, option: 'green', answer: 'green' } });
  await expectOpen(hub, byTool, `each deep mcp tool (${names.join(', ')}) called with the ask and an option`);
}, 120_000);

test('#24.4373d3bf an mcp connection to the hub can\'t call the answer, as a method or as a tool', async () => {
  const { hub, agent, bySocket } = await setUp();
  const { conn, answer } = await Conn.open(hub.socket, { hello: 'mcp', parent: { pid: agent.pid, start: agent.start() } });
  expect(String(answer?.role), `the hub takes the agent's deep mcp hello: ${JSON.stringify(answer)}`).toMatch(/^mcp/);
  const method = await conn.call('ask.answer', { ask: bySocket, option: 'drop' });
  expect(method.error?.code, `ask.answer from an mcp connection is refused for its role: ${JSON.stringify(method)}`).toBe('role');
  const tool = await conn.call('mcp.call', { tool: 'ask.answer', arguments: { ask: bySocket, option: 'drop' } });
  expect(tool.error, `mcp.call naming the answer is refused: ${JSON.stringify(tool)}`).toBeDefined();
  conn.close();
  await expectOpen(hub, bySocket, 'answered from an mcp connection to the hub');
}, 120_000);

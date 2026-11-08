// One MCP call as an agent makes it (AC2): starts `deep mcp` on stdio, initializes, calls the tool `deep_start` with
// the JSON arguments given, and prints the call's JSON-RPC reply as one line. Run as a child of a session's agent
// process, as the agent's MCP server is.
//
//   node mcp-call.mjs <node> <deep CLI> '<arguments as JSON>'
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [, , NODE, CLI, ARGS] = process.argv;
const server = spawn(NODE, [CLI, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
const waiting = new Map();
createInterface({ input: server.stdout }).on('line', (raw) => {
  let line;
  try { line = JSON.parse(raw); } catch { return; }
  if (line.id !== undefined && waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
});
let n = 0;
const call = (method, params) => new Promise((resolve) => {
  const id = ++n;
  waiting.set(id, resolve);
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});
const timer = setTimeout(() => { process.stdout.write(`${JSON.stringify({ error: { message: 'mcp-call: no reply in 90 s' } })}\n`); server.kill('SIGKILL'); process.exit(1); }, 90_000);
await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '0' } });
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
const reply = await call('tools/call', { name: 'deep_start', arguments: JSON.parse(ARGS) });
clearTimeout(timer);
process.stdout.write(`${JSON.stringify(reply)}\n`);
server.kill('SIGTERM');
process.exit(0);

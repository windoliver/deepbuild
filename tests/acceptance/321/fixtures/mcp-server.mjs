#!/usr/bin/env node
// A fake MCP server for issue #321's acceptance tests: a boundary DeepBuild doesn't own (a third-party server), so
// the one stand-in the suite allows itself (README, The fake MCP servers). It speaks MCP over stdio, one JSON-RPC
// message per line, as Claude Code starts a `"type": "stdio"` server from its config:
//
//   node mcp-server.mjs <name> <tools.json> <log.jsonl>
//
// <tools.json> is the server's code as installed: `{"version": "1.0.0", "tools": [<tool as tools/list gives it>]}`,
// read again at each `initialize` and `tools/list`, so a test "updates the server" by rewriting it. Every message
// it receives, from anyone who starts it (the hub learning its tool list, or the test standing in for Claude Code
// running a call), is appended to <log.jsonl> as one line `{"pid", "server", "method", "tool"?, "at"}` before it is
// answered, so a test counts the requests the server received, tools/call above all.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [name, toolsFile, logFile] = process.argv.slice(2);
if (!name || !toolsFile || !logFile) {
  process.stderr.write('usage: mcp-server.mjs <name> <tools.json> <log.jsonl>\n');
  process.exit(2);
}
const installed = () => JSON.parse(readFileSync(toolsFile, 'utf8'));
const reply = (id, body) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`);

createInterface({ input: process.stdin }).on('line', (raw) => {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof message !== 'object' || message === null) return;
  const tool = message.method === 'tools/call' && typeof message.params?.name === 'string' ? message.params.name : undefined;
  appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, server: name, method: message.method ?? null, ...(tool ? { tool } : {}), at: Date.now() })}\n`);
  if (message.id === undefined || message.id === null) return; // a notification
  const { version, tools } = installed();
  switch (message.method) {
    case 'initialize':
      return reply(message.id, { result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name, version } } });
    case 'ping':
      return reply(message.id, { result: {} });
    case 'tools/list':
      return reply(message.id, { result: { tools } });
    case 'tools/call':
      if (!tools.some((t) => t.name === tool)) return reply(message.id, { error: { code: -32602, message: `${name} has no tool ${tool}` } });
      return reply(message.id, { result: { content: [{ type: 'text', text: `${name} ran ${tool}` }], isError: false } });
    default:
      return reply(message.id, { error: { code: -32601, message: `${name} serves no method ${message.method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));

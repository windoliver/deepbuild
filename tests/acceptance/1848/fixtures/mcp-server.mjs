#!/usr/bin/env node
// A files server for issue #1848's AC2: a stdio MCP server that takes a path, a boundary DeepBuild doesn't own (a
// third-party server), so the one stand-in the suite allows itself (README, The hub up and the tool approved). It
// speaks MCP over stdio, one JSON-RPC message per line, as Claude Code starts a `"type": "stdio"` server from its
// config; the hub starts it the same way at each session start to record its tool list.
//
//   node mcp-server.mjs <name> <tools.json>
//
// <tools.json> is the server's code as installed: `{"version": "1.0.0", "tools": [<tool as tools/list gives it>]}`,
// read again at each request, so a test "updates the server" by rewriting it. Adapted from
// tests/acceptance/321/fixtures/mcp-server.mjs (same repo, same license), without its request log.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [name, toolsFile] = process.argv.slice(2);
if (!name || !toolsFile) {
  process.stderr.write('usage: mcp-server.mjs <name> <tools.json>\n');
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
  if (typeof message !== 'object' || message === null || message.id === undefined || message.id === null) return;
  const { version, tools } = installed();
  switch (message.method) {
    case 'initialize':
      return reply(message.id, { result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name, version } } });
    case 'ping':
      return reply(message.id, { result: {} });
    case 'tools/list':
      return reply(message.id, { result: { tools } });
    default:
      return reply(message.id, { error: { code: -32601, message: `${name} serves no method ${message.method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));

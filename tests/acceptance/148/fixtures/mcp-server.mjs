#!/usr/bin/env node
// A stdio MCP server the agents start: initialize, tools/list and tools/call, nothing else. A boundary DeepBuild doesn't
// own, and the suite's only stand-in for a real server.
//
//   node mcp-server.mjs <name> <log> [<variable>]
//
// At its start it appends one JSON line to <log>: its name, its PID and the SHA-256 of the environment variable
// <variable> (null when unset). It never prints, logs or returns the variable's value, so a test can tell the server got
// its token without the token reaching any file through it.
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [, , NAME, LOG, VARIABLE] = process.argv;
const value = VARIABLE ? process.env[VARIABLE] : undefined;
if (LOG) appendFileSync(LOG, `${JSON.stringify({ name: NAME, pid: process.pid, at: Date.now(), token_sha256: value ? createHash('sha256').update(value).digest('hex') : null })}\n`);

const TOOLS = [
  { name: 'list_issues', description: 'List issues in a repository', inputSchema: { type: 'object', properties: { repo: { type: 'string' } } } },
  { name: 'create_issue', description: 'Open an issue in a repository', inputSchema: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' } }, required: ['title'] } },
];
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
createInterface({ input: process.stdin }).on('line', (raw) => {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: NAME, version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: TOOLS } });
  else if (m.method === 'tools/call') send({ id: m.id, result: { content: [{ type: 'text', text: 'ok' }] } });
  else if (m.method === 'ping') send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
});
process.stdin.on('end', () => process.exit(0));

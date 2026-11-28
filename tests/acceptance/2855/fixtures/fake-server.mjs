#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [mode, name, toolsFile, logFile] = process.argv.slice(2);
if (!['modern', 'minus32601', 'silent'].includes(mode) || !name || !toolsFile || !logFile) {
  process.stderr.write('usage: fake-server.mjs modern|minus32601|silent <name> <tools.json> <log.jsonl>\n');
  process.exit(2);
}
const MODERN = '2026-07-28';
const PV = 'io.modelcontextprotocol/protocolVersion';
const installed = () => JSON.parse(readFileSync(toolsFile, 'utf8'));
const reply = (id, body) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`);
const error = (id, code, message, data) => reply(id, { error: { code, message, ...(data ? { data } : {}) } });

createInterface({ input: process.stdin }).on('line', (raw) => {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (typeof m !== 'object' || m === null) return;
  const version = typeof m.params?._meta?.[PV] === 'string' ? m.params._meta[PV] : null;
  const tool = m.method === 'tools/call' && typeof m.params?.name === 'string' ? m.params.name : undefined;
  appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, server: name, method: m.method ?? null, id: m.id ?? null, version, ...(tool ? { tool } : {}), at: Date.now() })}\n`);
  if (m.id === undefined || m.id === null) return;
  const { version: serverVersion, tools } = installed();
  const call = () => (tools.some((t) => t.name === tool)
    ? { content: [{ type: 'text', text: `${name} ran ${tool}` }], isError: false }
    : undefined);
  if (mode === 'modern') {
    if (m.method === 'server/discover') {
      return reply(m.id, { result: { resultType: 'complete', supportedVersions: [MODERN], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name, version: serverVersion } }, ttlMs: 0, cacheScope: 'private' } });
    }
    if (m.method === 'initialize') return error(m.id, -32601, `${name} takes no initialize: it serves ${MODERN} only, each request naming it in _meta`);
    if (version === null) return error(m.id, -32600, `${name} serves ${MODERN} only: name it in the request's _meta`);
    if (version !== MODERN) return error(m.id, -32022, 'Unsupported protocol version', { supported: [MODERN], requested: version });
    if (m.method === 'tools/list') return reply(m.id, { result: { resultType: 'complete', tools, ttlMs: 0, cacheScope: 'private' } });
    if (m.method === 'tools/call') {
      const result = call();
      return result ? reply(m.id, { result: { resultType: 'complete', ...result } }) : error(m.id, -32602, `${name} has no tool ${tool}`);
    }
    return error(m.id, -32601, `${name} serves no method ${m.method}`);
  }
  switch (m.method) {
    case 'initialize':
      return reply(m.id, { result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name, version: serverVersion } } });
    case 'ping':
      return reply(m.id, { result: {} });
    case 'tools/list':
      return reply(m.id, { result: { tools } });
    case 'tools/call': {
      const result = call();
      return result ? reply(m.id, { result }) : error(m.id, -32602, `${name} has no tool ${tool}`);
    }
    default:
      if (mode === 'silent') return undefined;
      return error(m.id, -32601, `${name} serves no method ${m.method}`);
  }
});
process.stdin.on('end', () => process.exit(0));

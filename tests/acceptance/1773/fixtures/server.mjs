// A fixture stdio MCP server (#1773): it answers initialize and tools/list, one JSON message a line, with the tools in
// tools.json beside it. Each start leaves a mark, a line with its PID in `started` beside it, so a test can tell
// whether anything ever started it.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
appendFileSync(join(here, 'started'), `${process.pid} ${process.argv.slice(2).join(' ')}\n`);
const { name, version, tools } = JSON.parse(readFileSync(join(here, 'tools.json'), 'utf8'));
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
createInterface({ input: process.stdin }).on('line', (raw) => {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name, version } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools } });
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
});

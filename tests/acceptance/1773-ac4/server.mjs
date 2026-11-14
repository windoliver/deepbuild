// A tiny real stdio MCP server for the fixture: on start it writes `<marker dir>/<name>.started`, so a test can see
// whether it was ever started; it answers initialize and tools/list with one tool named `<name>_tool`.
// Usage: node server.mjs <name> <marker dir> [args the config passes...]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const [name, markers, ...rest] = process.argv.slice(2);
writeFileSync(join(markers, `${name}.started`), JSON.stringify({ pid: process.pid, args: rest }));
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name, version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: `${name}_tool`, inputSchema: { type: 'object' } }] } });
});

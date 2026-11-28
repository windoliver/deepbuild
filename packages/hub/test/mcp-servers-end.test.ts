import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { toolLists } from '../src/mcp-servers.ts';

const SERVER = `
let buffer = '';
const out = (m) => JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n';
process.stdin.setEncoding('utf8').on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buffer.slice(0, at));
    buffer = buffer.slice(at + 1);
    if (m.method === 'server/discover') process.stdout.write(out({ id: m.id, result: { supportedVersions: ['2026-07-28'], _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'late', version: '1.0.0' } } } }));
    if (m.method === 'tools/list') process.stdout.write(out({ id: m.id, result: { tools: [{ name: 'asked' }] } }) + out({ id: m.id + 1, result: { tools: [{ name: 'unasked' }] } }));
  }
});
`;

const home = process.env.HOME;
const made: string[] = [];
afterEach(() => {
  process.env.HOME = home;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('keeps a list as it stood when the last page came, whatever follows it in the same chunk', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-end-')));
  made.push(dir);
  writeFileSync(join(dir, 'server.mjs'), SERVER);
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { late: { command: process.execPath, args: [join(dir, 'server.mjs')] } } }));
  process.env.HOME = dir;
  const listed = await toolLists(dir);
  expect(listed.map((l) => [l.server, l.tools.map((t) => t.name)])).toEqual([['late', ['asked']]]);
});

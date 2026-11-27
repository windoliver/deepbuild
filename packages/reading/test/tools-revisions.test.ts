// The reading tools keep a copy of the revisions they serve, since the job's sandbox grants tools.mjs alone (#2855):
// what server/discover lists must stay mcp.meta@1's revisions, then mcp.handshake@1's, newest first, as the other
// three servers read them from the contract entries.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { expect, it } from 'vitest';

const tools = new URL('../dist/tools.mjs', import.meta.url);
const entry = (name: string): string[] =>
  (JSON.parse(readFileSync(new URL(`../../contracts/schemas/${name}`, import.meta.url), 'utf8')) as { properties: { protocolVersion: { enum: string[] } } }).properties.protocolVersion.enum;

it('the reading tools list the contract entries\' revisions at server/discover', async () => {
  const child = spawn(process.execPath, [tools.pathname, '/nonexistent'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = createInterface({ input: child.stdout! });
  const listed = new Promise<unknown>((resolve) => {
    replies.on('line', (line) => resolve((JSON.parse(line) as { result?: { supportedVersions?: unknown } }).result?.supportedVersions));
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} })}\n`);
  const got = await listed;
  child.kill();
  expect(got).toEqual([...entry('mcp.meta@1.json')].reverse().concat([...entry('mcp.handshake@1.json')].reverse()));
});

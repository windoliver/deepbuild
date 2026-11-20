// The reading tools write out each tool's title and hints, since the job's sandbox grants tools.mjs alone (#2898):
// what they list must stay what scripts/skill.mjs generates in packages/hub/annotations.json.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { expect, it } from 'vitest';

const tools = new URL('../dist/tools.mjs', import.meta.url);
const generated = new URL('../../hub/annotations.json', import.meta.url);

it('the reading tools list the title and hints the generated table gives each', async () => {
  const child = spawn(process.execPath, [tools.pathname, '/nonexistent'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = createInterface({ input: child.stdout! });
  const listed = new Promise<{ name: string; annotations?: unknown }[]>((resolve) => {
    replies.on('line', (line) => {
      const m = JSON.parse(line) as { id: number; result: { tools?: { name: string; annotations?: unknown }[] } };
      if (m.id === 2) resolve(m.result.tools ?? []);
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  const got = await listed;
  child.kill();
  const table = existsSync(generated) ? JSON.parse(readFileSync(generated, 'utf8')) as Record<string, unknown> : {};
  expect(Object.fromEntries(got.map((t) => [t.name, t.annotations]))).toEqual({ read: table.read, find: table.find });
  expect(got.map((t) => t.annotations)).not.toContain(undefined);
});

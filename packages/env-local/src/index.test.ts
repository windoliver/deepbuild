import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Host } from '@deepbuild/supervisor';
import { afterEach, expect, test } from 'vitest';
import { portKind, upStack } from './index.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const repo = (ready: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'env-local-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.deepbuild'));
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), `environment:\n  up: "true"\n  ports: [web]\n  ready: { http: ${JSON.stringify(ready)}, within: 1 }\n`);
  return dir;
};
// Nothing may start for a block that can't be checked; a start here fails the test.
const noStart = { start: () => { throw Error('started a stack whose health route was never checkable'); } } as unknown as Host;

test.each([
  ['an https route', 'https://127.0.0.1:${web}/health'],
  ['a variable that names no port', 'http://127.0.0.1:${WEB}/health'],
  ['a route off this machine', 'http://example.invalid:${web}/health'],
  ['a fixed port beside leased ones', 'http://127.0.0.1:8080/health'],
])('a health route with %s is BLOCKED before anything starts', async (_, ready) => {
  const up = await upStack(noStart, { run: 'run:TEST', folder: repo(ready) });
  expect(up).toMatchObject({ status: 'BLOCKED', cause: expect.stringContaining('environment.ready.http') });
});

test('a port something listens on at ::1 alone is not free', async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen({ port: 0, host: '::1' }, resolve));
  try {
    const port = (server.address() as net.AddressInfo).port;
    expect(await portKind().free!(String(port))).toBe(false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

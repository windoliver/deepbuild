import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { nodeHttp, Sources, type Recording } from '../src/sources.js';
const secrets = { get: async () => undefined, set: async () => {}, delete: async () => {} };
const decl = { host: 'fixture.test', secret: null, auth: null, quota: { per_minute: 10, per_day: 10 } };

it('#1820 a reachable server ignoring large ranges is refused as range_not_supported, never offline', async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 7);
  const server = createServer((_req, res) => res.writeHead(200, { 'content-length': bytes.length }).end(bytes));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = mkdtempSync(join(tmpdir(), 'asset-range-'));
  const source = new Sources({ now: () => 0, secrets, append: async () => {}, http: (req, signal) => nodeHttp({ ...req, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/asset` }, signal) });
  try {
    await expect(source.download('fixture', 'ext.fixture.asset', decl, '/asset', { file: join(root, 'file'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })).rejects.toThrow('range_not_supported');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

it('#1820 replay of a resumed download chooses its recorded range, not an earlier range of the same URL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'asset-range-replay-'));
  const file = join(root, 'partial');
  const bytes = Buffer.alloc(1024 * 1024 + 23, 8);
  const replay: Recording = { v: 1, calls: [[0, 1048575], [1048576, bytes.length - 1]].map(([a, b]) => ({ source: 'ext.fixture.asset', request: { method: 'GET', url: 'https://fixture.test/asset', headers: { range: `bytes=${a}-${b}` } }, answer: { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${bytes.length}` }, body: bytes.subarray(a, b! + 1).toString('base64') } })) };
  writeFileSync(file, bytes.subarray(0, 1048576));
  const source = new Sources({ now: () => 0, secrets, append: async () => {}, replay, http: async () => { throw Error('replay made a live call'); } });
  try { expect(await source.download('fixture', 'ext.fixture.asset', decl, '/asset', { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })).toBe(file); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

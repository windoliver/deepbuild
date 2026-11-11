import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Sources, type HttpRequest } from '../src/sources.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const decl = { host: 'assets.example', secret: null, auth: null, quota: { per_minute: 4, per_day: 10 } };
function world(answer: (req: HttpRequest) => { status: number; headers: Record<string, string>; body: string }) {
  const root = mkdtempSync(join(tmpdir(), 'asset-source-'));
  roots.push(root);
  const requests: HttpRequest[] = [];
  const events: Record<string, unknown>[] = [];
  const source = new Sources({ now: () => 1000, secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    http: async (req) => { requests.push(req); return answer(req); }, append: async (_kind, data) => { events.push(data); } });
  return { source, root, file: join(root, 'asset.part'), requests, events };
}

it('#1820 resumes bounded Source ranges after a lost connection and records their cost', async () => {
  const bytes = Buffer.alloc(1024 * 1024 + 71, 23);
  let fail = true;
  const w = world((req) => {
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range!)!;
    if (Number(start) && fail) { fail = false; throw Error('offline'); }
    return { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(Number(start), Number(end) + 1).toString('base64') };
  });
  const spec = { file: w.file, sha256: hash(bytes), size: bytes.length };
  await expect(w.source.download('fixture', 'fixture.asset', decl, '/sample.bin', spec)).rejects.toThrow(/no answer/);
  expect(readFileSync(w.file).length).toBe(1024 * 1024);
  expect(await w.source.download('fixture', 'fixture.asset', decl, '/sample.bin', spec)).toBe(w.file);
  expect(readFileSync(w.file)).toEqual(bytes);
  expect(w.requests.map((r) => r.headers.range)).toEqual(['bytes=0-1048575', 'bytes=1048576-1048646', 'bytes=1048576-1048646']);
  expect(w.events.map((e) => e.outcome)).toEqual(['answered', 'unreachable', 'answered']);
});

it('#1820 refuses disk pressure before any source call and removes a corrupt download', async () => {
  const bytes = Buffer.from('other bytes');
  const w = world(() => ({ status: 200, headers: {}, body: bytes.toString('base64') }));
  const disk = statfsSync(w.root);
  const size = Math.floor(disk.bavail * disk.bsize * 0.6);
  await expect(w.source.download('fixture', 'fixture.asset', decl, '/huge.bin', { file: w.file, sha256: hash(bytes), size })).rejects.toThrow(new RegExp(String(size)));
  expect(w.requests).toHaveLength(0);
  expect(existsSync(w.file)).toBe(false);
  await expect(w.source.download('fixture', 'fixture.asset', decl, '/sample.bin', { file: w.file, sha256: hash(Buffer.from('right bytes')), size: bytes.length })).rejects.toThrow(/sample.bin.*sha256/);
  expect(existsSync(w.file)).toBe(false);
});

it('#1820 a resumed range is checked and every chunk consumes the source quota', async () => {
  const bytes = Buffer.alloc(1024 * 1024 + 71, 17);
  const w = world(() => ({ status: 206, headers: { 'content-range': `bytes 0-1048575/${bytes.length}` }, body: bytes.subarray(0, 1024 * 1024).toString('base64') }));
  const spec = { file: w.file, sha256: hash(bytes), size: bytes.length };
  await expect(w.source.download('fixture', 'fixture.asset', { ...decl, quota: { per_minute: 1, per_day: 10 } }, '/sample.bin', spec)).rejects.toThrow(/quota/);
  expect(w.requests).toHaveLength(1);
  await expect(w.source.download('fixture', 'fixture.other', decl, '/sample.bin', spec)).rejects.toThrow(/invalid_range_response/);
  expect(existsSync(w.file)).toBe(false);
});

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Sources, type HttpRequest } from '../src/sources.js';

it('#1820 a quota pause is retryable at its reset and resumes the verified partial cursor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'asset-quota-'));
  const file = join(root, 'download.part');
  let now = 0;
  const calls: HttpRequest[] = [];
  const bytes = Buffer.alloc(1024 * 1024 + 31, 41);
  const source = new Sources({ now: () => now, secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} }, append: async () => {}, http: async (req) => {
    calls.push(req);
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range!)!;
    return { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${bytes.length}` }, body: bytes.subarray(Number(a), Number(b) + 1).toString('base64') };
  } });
  const decl = { host: 'asset.example', secret: null, auth: null, quota: { per_minute: 1, per_day: 10 } };
  const spec = { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  try {
    let pause: unknown;
    try { await source.download('fixture', 'ext.fixture.asset', decl, '/file.bin', spec); } catch (e) { pause = e; }
    expect(pause).toMatchObject({ until: 60_000 });
    expect(readFileSync(file).length).toBe(1024 * 1024);
    now = 60_000;
    expect(await source.download('fixture', 'ext.fixture.asset', decl, '/file.bin', spec)).toBe(file);
    expect(readFileSync(file)).toEqual(bytes);
    expect(calls.map((r) => r.headers.range)).toEqual(['bytes=0-1048575', 'bytes=1048576-1048606']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

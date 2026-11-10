import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Sources } from '../src/sources.js';

it('#1820 removed mismatched bytes leave a recorded failure, not a broken recording or retained rejected content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'asset-bad-recording-'));
  const bytes = Buffer.from('rejected bytes');
  const source = new Sources({ now: () => 0, secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} }, append: async () => {},
    http: async () => ({ status: 200, headers: {}, body: bytes.toString('base64') }) });
  try {
    await expect(source.download('fixture', 'ext.fixture.asset', { host: 'example.test', secret: null, auth: null, quota: { per_minute: 10, per_day: 10 } }, '/asset', { file: join(root, 'partial'), kept: join(root, 'kept'), size: bytes.length, sha256: '0'.repeat(64) })).rejects.toThrow(/sha256/);
    const calls = source.recording().calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.answer).toHaveProperty('error');
    expect(JSON.stringify(calls)).not.toContain(bytes.toString('base64'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

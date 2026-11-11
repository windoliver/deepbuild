import { createHash } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Sources } from '../src/sources.js';

it('#1820 binary Source recordings read the kept asset; missing or changed bytes cannot be exported as a replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'asset-recording-'));
  const bytes = Buffer.from('a checked binary for replay');
  const file = join(root, 'download.part');
  const kept = join(root, 'kept');
  const spec = { file, kept, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const source = new Sources({ now: () => 0, secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} }, append: async () => {},
    http: async () => ({ status: 200, headers: {}, body: bytes.toString('base64') }) });
  try {
    await source.download('fixture', 'ext.fixture.asset', { host: 'example.test', secret: null, auth: null, quota: { per_minute: 10, per_day: 10 } }, '/asset', spec);
    renameSync(file, kept);
    expect(source.recording().calls[0]!.answer).toMatchObject({ body: bytes.toString('base64') });
    writeFileSync(kept, 'not the checked bytes');
    expect(() => source.recording()).toThrow(/recording.*bytes/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

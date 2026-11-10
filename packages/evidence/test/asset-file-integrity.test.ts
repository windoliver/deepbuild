import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openEvidenceStore } from '../src/index.js';

it('#1820 a file intake repairs corrupt cached bytes and never keeps a file that changed after the download checked it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asset-integrity-'));
  const bytes = Buffer.from('listed asset bytes');
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  try {
    const store = await openEvidenceStore({ root: join(root, 'store') });
    const file = join(root, 'asset.part');
    await writeFile(file, bytes);
    const spec = { file, sha256: hash(bytes), kind: 'asset.pack', source: 'fixture', redaction: 'complete' as const, license: { name: 'CC0-1.0', allows: [] } };
    expect((await store.connect({ role: 'deepbuild', via: 'job' }).file(spec)).status).toBe('stored');
    await writeFile(join(root, 'store', hash(bytes).slice(0, 2), hash(bytes).slice(2)), 'corrupted cache');
    expect((await store.connect({ role: 'deepbuild', via: 'job' }).file(spec)).status).toBe('stored');
    expect(Buffer.from(await store.read(hash(bytes)))).toEqual(bytes);
    const changed = Buffer.from('changed after check');
    await writeFile(file, changed);
    expect(await store.connect({ role: 'deepbuild', via: 'job' }).file(spec)).toMatchObject({ status: 'refused' });
    expect(await store.get(hash(changed))).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

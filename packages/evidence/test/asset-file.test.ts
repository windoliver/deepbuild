import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openEvidenceStore } from '../src/index.js';

it('#1820 keeps a downloaded file by its bytes, independently of the staging file, with its license', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asset-file-'));
  try {
    const bytes = Buffer.from('downloaded sample bytes');
    const input = join(root, 'download.part');
    await writeFile(input, bytes);
    const store = await openEvidenceStore({ root: join(root, 'evidence') });
    const writer = store.connect({ role: 'deepbuild', via: 'job' });
    const put = await writer.file({ file: input, kind: 'asset.pack', source: 'fixture/samples@1.0.0', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['export'] } });
    expect(put.status).toBe('stored');
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(await store.get(hash)).toMatchObject({ sha256: hash, size: bytes.length, origin: 'deepbuild', license: { name: 'CC0-1.0', allows: ['export'] } });
    expect(await readFile(input)).toEqual(bytes);
    await rm(input);
    expect(Buffer.from(await store.read(hash))).toEqual(bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

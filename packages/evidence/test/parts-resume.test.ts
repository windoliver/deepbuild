// #2365: reopening the archive must not inflate old evidence just to continue its content hash.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openEvidenceStore } from '../src/index.js';

const label = { kind: 'transcript-copy', source: 'archive:resume-fixture', redaction: 'complete' as const, license: { name: 'session', allows: [] } };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('a reopened store extends the verified concatenation without reading any preceding part', async () => {
  const root = await fsp.mkdtemp(join(tmpdir(), 'deep-parts-resume-'));
  try {
    // Past the size under which a joined copy keeps no resumable hash and is read again after a restart.
    const first = Buffer.from('first résumé 🛒\n'.repeat(480_000));
    const second = Buffer.from('second line\n'.repeat(1000));
    const third = Buffer.from('third line\n');
    const store = await openEvidenceStore({ root });
    const writer = store.connect({ role: 'deepbuild', via: 'capture' });
    for (const bytes of [first, second]) expect((await writer.put({ ...label, bytes })).status).toBe('stored');
    const parts = [sha(first), sha(second)];
    const before = await writer.put({ ...label, parts });
    expect(before).toMatchObject({ status: 'stored', evidence: { sha256: sha(Buffer.concat([first, second])) } });
    const reopened = await openEvidenceStore({ root });
    const next = reopened.connect({ role: 'deepbuild', via: 'capture' });
    expect((await next.put({ ...label, bytes: third })).status).toBe('stored');
    const paths: string[] = [];
    const original = fs.createReadStream;
    fs.createReadStream = ((path, options) => { paths.push(String(path)); return original(path, options); }) as typeof fs.createReadStream;
    syncBuiltinESMExports();
    try {
      const joined = await next.put({ ...label, parts: [...parts, sha(third)] });
      expect(joined).toMatchObject({ status: 'stored', evidence: { sha256: sha(Buffer.concat([first, second, third])) } });
    } finally { fs.createReadStream = original; syncBuiltinESMExports(); }
    const old = paths.filter((path) => parts.some((p) => path.includes(p.slice(2))));
    expect(old, 'the added part is read back; the old parts are not decompressed or hashed again after reopen').toEqual([]);
    expect(Buffer.from(await reopened.read(sha(Buffer.concat([first, second, third]))))).toEqual(Buffer.concat([first, second, third]));
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
}, 120_000);

test('continued hashes across block and UTF-8 boundaries equal Node SHA-256, including empty and repeated parts', async () => {
  const root = await fsp.mkdtemp(join(tmpdir(), 'deep-parts-digests-'));
  try {
    let store = await openEvidenceStore({ root });
    const parts: string[] = [];
    const all: Buffer[] = [];
    for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1025]) {
      const bytes = Buffer.from('é🙂一'.repeat(size)).subarray(0, size);
      const writer = store.connect({ role: 'deepbuild', via: 'capture' });
      await writer.put({ ...label, bytes }); parts.push(sha(bytes)); all.push(bytes);
      const result = await writer.put({ ...label, parts });
      expect(result).toMatchObject({ status: 'stored', evidence: { sha256: sha(Buffer.concat(all)), size: Buffer.concat(all).length } });
      store = await openEvidenceStore({ root });
    }
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

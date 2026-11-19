// #2365: a transcript's immutable parts keep its ordinary content hash and retention, without storing it whole.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openEvidenceStore } from '../src/index.js';

const labels = { kind: 'transcript-copy', source: 'archive:fixture', redaction: 'complete' as const, license: { name: 'session', allows: [] } };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

test('parts read as their concatenation, survive reopen and retention, and a reordered manifest fails its hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deep-evidence-parts-'));
  try {
    let now = 0;
    let store = await openEvidenceStore({ root, now: () => now });
    const writer = store.connect({ role: 'deepbuild', via: 'capture' });
    for (const text of ['first\n', 'second\n', 'uncited\n']) {
      expect((await writer.put({ ...labels, bytes: Buffer.from(text) })).status).toBe('stored');
    }
    const parts = [digest('first\n'), digest('second\n')];
    const result = await writer.put({ ...labels, parts });
    expect(result.status).toBe('stored');
    const sha = digest('first\nsecond\n');
    expect(await store.get(sha)).toMatchObject({ sha256: sha, size: 13, parts });
    expect(Buffer.from(await store.read(sha)).toString()).toBe('first\nsecond\n');
    const chunks = [];
    for await (const bytes of store.chunks(sha)) chunks.push(Buffer.from(bytes).toString());
    expect(chunks.join('')).toBe('first\nsecond\n');
    store = await openEvidenceStore({ root, now: () => now });
    now = 40 * 86_400_000;
    expect((await store.retain({ archived: new Set([sha]), cited: new Set() })).removed).toEqual([digest('uncited\n')]);
    expect(Buffer.from(await store.read(sha)).toString()).toBe('first\nsecond\n');
    const path = join(root, sha.slice(0, 2), `${sha.slice(2)}.parts`);
    const manifest = JSON.parse(await readFile(path, 'utf8')) as string[];
    await writeFile(path, JSON.stringify(manifest.reverse()));
    await expect(store.read(sha)).rejects.toThrow(/corrupt|hash/);
    expect(await store.verify(sha)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

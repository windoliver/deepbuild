// #2365 with #1410: a joined copy is a manifest and its parts' files, and a FULL commit that names it needs each to last.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// The store's `open`, each handle tagged with its path: every sync of a handle is logged by that path.
const synced: string[] = [];
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  const tagged = async (path: string, ...rest: [string]): Promise<FileHandle> => {
    const handle = await real.open(path, ...rest);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => { await sync(); synced.push(String(path)); };
    return handle;
  };
  return { ...real, open: tagged };
});
const { openEvidenceStore } = await import('../src/index.js');

const labels = { kind: 'transcript-copy', source: 'archive:fixture', redaction: 'complete' as const, license: { name: 'session', allows: [] } };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const roots: string[] = [];
afterEach(() => { synced.length = 0; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function twoParts() {
  const root = mkdtempSync(join(tmpdir(), 'deep-evidence-sync-parts-'));
  roots.push(root);
  const store = await openEvidenceStore({ root, now: () => 0 });
  const writer = store.connect({ role: 'deepbuild', via: 'capture' });
  for (const text of ['first\n', 'second\n']) expect((await writer.put({ ...labels, bytes: Buffer.from(text) })).status).toBe('stored');
  const at = (sha: string) => join(root, sha.slice(0, 2), sha.slice(2));
  const parts = [digest('first\n'), digest('second\n')], sha = digest('first\nsecond\n');
  return { root, store, writer, parts, sha, manifest: `${at(sha)}.parts`, files: parts.map((part) => `${at(part)}.zst`) };
}

it('a sync that names a joined copy syncs its manifest and the file of each part, then the journal that finds them', async () => {
  const { root, store, writer, parts, sha, manifest, files } = await twoParts();
  expect(await writer.put({ ...labels, parts })).toMatchObject({ status: 'stored', evidence: { sha256: sha } });
  synced.length = 0;
  await store.sync([sha]);
  expect(synced, 'the manifest and both parts').toEqual(expect.arrayContaining([manifest, ...files]));
  const journal = synced.lastIndexOf(join(root, 'records.jsonl'));
  for (const path of [manifest, ...files]) expect(synced.indexOf(path), `${basename(path)} before the journal`).toBeLessThan(journal);
});

it("a manifest put over one on disk the store's journal doesn't hold is synced before it replaces it", async () => {
  const { writer, parts, sha, manifest } = await twoParts();
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify(parts));
  synced.length = 0;
  expect(await writer.put({ ...labels, parts })).toMatchObject({ status: 'stored', evidence: { sha256: sha } });
  expect(synced.filter((path) => basename(path).startsWith('.tmp-')), 'a sync of the new manifest before it replaced the one there').not.toEqual([]);
});

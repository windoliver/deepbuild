import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// The store's `open`, each handle tagged with its path: every sync of a handle is logged by that path, and one whose
// path `fail` names fails, as a disk that refuses it.
const synced: string[] = [];
const fail: { path?: string } = {};
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  const tagged = async (path: string, ...rest: [string]): Promise<FileHandle> => {
    const handle = await real.open(path, ...rest);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      if (String(path) === fail.path) throw Object.assign(Error('EIO: i/o error, fsync'), { code: 'EIO' });
      await sync();
      synced.push(String(path));
    };
    return handle;
  };
  return { ...real, open: tagged };
});
const { openEvidenceStore } = await import('../src/index.js');

const roots: string[] = [];
afterEach(() => { synced.length = 0; fail.path = undefined; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function stored(text: string) {
  const root = mkdtempSync(join(tmpdir(), 'deep-evidence-journal-'));
  roots.push(root);
  const store = await openEvidenceStore({ root, now: () => 0 });
  const result = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: Buffer.from(text), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] } });
  if (result.status !== 'stored') throw Error(result.reason);
  const sha = result.evidence.sha256;
  return { root, store, sha, file: join(root, sha.slice(0, 2), sha.slice(2)), journal: join(root, 'records.jsonl') };
}

it("a sync makes the store's line for each file durable too, so a file that survives a cut is still found by its hash (#1410)", async () => {
  const { store, sha, file, journal } = await stored('a screenshot');
  synced.length = 0;
  await store.sync([sha]);
  expect(synced, 'the file is synced').toContain(file);
  expect(synced.indexOf(journal), 'then the journal that finds it').toBeGreaterThan(synced.indexOf(file));
});

it('a file whose journal sync failed is synced again by the next sync that names it (#1410)', async () => {
  const { store, sha, journal } = await stored('a log');
  fail.path = journal;
  await expect(store.sync([sha])).rejects.toThrow('EIO');
  fail.path = undefined;
  synced.length = 0;
  await store.sync([sha]);
  expect(synced, 'the journal it failed on').toContain(journal);
});

it('a journal compacted at open is synced before it replaces the old one, and its folder after (#1410)', async () => {
  const { root, journal } = await stored('a log');
  // More lines than the journal holds records, as after many removals: the next open compacts it.
  appendFileSync(journal, 'cut short\n'.repeat(1200));
  synced.length = 0;
  await openEvidenceStore({ root, now: () => 0 });
  const temp = synced.findIndex((path) => basename(path).startsWith('.tmp-'));
  expect(temp, 'the compacted journal, before its rename').toBeGreaterThanOrEqual(0);
  expect(synced.indexOf(root, temp), 'the root that holds its new name').toBeGreaterThan(temp);
});

it('a file put again by path over one already stored is synced before it replaces it, so a synced file stays whole (#1410)', async () => {
  const { root, store, sha, file } = await stored('the same bytes');
  await store.sync([sha]);
  const input = join(root, 'input.bin');
  writeFileSync(input, 'the same bytes');
  synced.length = 0;
  const again = await store.connect({ role: 'deepbuild', via: 'capture' }).file({ file: input, kind: 'asset.pack', source: 'fixture/samples@1.0.0', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['export'] } });
  if (again.status !== 'stored') throw Error(again.reason);
  expect(again.evidence.sha256).toBe(sha);
  // The copy that replaced the file was synced under its own name, before the rename made it the file.
  expect(synced.filter((path) => path !== file && !path.endsWith('records.jsonl')), 'a sync of the copy before it replaced the synced file').not.toEqual([]);
});

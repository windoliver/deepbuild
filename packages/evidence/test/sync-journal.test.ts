import { mkdtempSync, rmSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// The store's `open`, each handle tagged with its path, and every sync of a handle logged by that path.
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

const roots: string[] = [];
afterEach(() => { synced.length = 0; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("a sync makes the store's line for each file durable too, so a file that survives a cut is still found by its hash (#1410)", async () => {
  const root = mkdtempSync(join(tmpdir(), 'deep-evidence-journal-'));
  roots.push(root);
  const store = await openEvidenceStore({ root, now: () => 0 });
  const result = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: Buffer.from('a screenshot'), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] } });
  if (result.status !== 'stored') throw Error(result.reason);
  synced.length = 0;
  await store.sync([result.evidence.sha256]);
  expect(synced, 'the file, then the journal that indexes it').toContain(join(root, 'records.jsonl'));
  expect(synced).toContain(join(root, result.evidence.sha256.slice(0, 2), result.evidence.sha256.slice(2)));
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// The store's `open`, with a step run first: the file system as it is when another process acts between two calls.
const before: { open?: (path: string) => void } = {};
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, open: (path: string, ...rest: [string]) => { before.open?.(path); return real.open(path, ...rest); } };
});
const { openEvidenceStore } = await import('../src/index.js');

const roots: string[] = [];
afterEach(() => { before.open = undefined; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('a file removed after the sync looked at it and before it opened it has nothing to sync (#1410)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deep-evidence-gone-'));
  roots.push(root);
  const store = await openEvidenceStore({ root, now: () => 0 });
  const result = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: Buffer.from('a log retention removes'), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] } });
  if (result.status !== 'stored') throw Error(result.reason);
  const sha = result.evidence.sha256;
  const file = join(root, sha.slice(0, 2), sha.slice(2));
  let removed = 0;
  before.open = (path) => { if (path === file) { rmSync(file); removed += 1; } };
  await store.sync([sha]);
  expect(removed, 'the sync reached the file, which was removed under it').toBe(1);
});

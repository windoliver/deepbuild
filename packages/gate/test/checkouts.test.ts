// What a crash leaves goes at the next open: a checkout in the root, and an index holder in the object store.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { LeaseTable } from '@deepbuild/leases';
import type { Supervisor } from '@deepbuild/supervisor';
import { openCheckouts } from '../src/index.ts';

it('opening the service removes an index holder a crash left in the object store, and nothing else there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-checkouts-'));
  try {
    const store = join(dir, 'objects');
    mkdirSync(join(store, 'index-a1B2c3'), { recursive: true });
    writeFileSync(join(store, 'index-a1B2c3', 'index'), 'a copy of the index');
    mkdirSync(join(store, 'refs'));
    // Opening starts no run and takes no lease.
    const checkouts = await openCheckouts({ store, root: join(dir, 'checkouts'), kinds: [], host: {} as Supervisor, leases: {} as LeaseTable, now: Date.now });
    await checkouts.close();
    expect([existsSync(join(store, 'index-a1B2c3')), existsSync(join(store, 'refs'))]).toEqual([false, true]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

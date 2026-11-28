import { join } from 'node:path';
import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Opened, World } from '../355/helpers.ts';

export * from '../355/helpers.ts';
export async function withRecord<T>(w: World, fn: (o: Opened) => Promise<T>): Promise<T> {
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  const readers = (adapters as { transcriptReaders?: unknown }).transcriptReaders;
  const store = await openEvidenceStore({ root: join(w.root, 'evidence'), now: w.clock.now });
  const options = { path: join(w.root, 'ledger.db'), now: w.clock.now, evidence: store, readers };
  const record = await openRecord(options as unknown as Parameters<typeof openRecord>[0]);
  try {
    return await fn({ record, store });
  } finally {
    await record.close();
  }
}

import { join } from 'node:path';
import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { makeClock, T0, tempRoot, type LearnedRecord, type World } from '../62/helpers.ts';

export * from '../62/helpers.ts';

type RecordOptions = Parameters<typeof openRecord>[0];

export async function openWorld(start = T0): Promise<World> {
  const root = tempRoot();
  const clock = makeClock(start);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  const readers = (adapters as unknown as { transcriptReaders?: readonly unknown[] }).transcriptReaders;
  const options = { path: join(root, 'record', 'record.sqlite'), now: clock.now, evidence: store, readers } as unknown as RecordOptions;
  const record = (await openRecord(options)) as LearnedRecord;
  return { root, clock, store, record };
}

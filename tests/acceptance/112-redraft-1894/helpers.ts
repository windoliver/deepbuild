import { join } from 'node:path';
import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { T0, tempDir, type Clock, type World } from '../112/helpers.ts';

export * from '../112/helpers.ts';
export async function openWorld(): Promise<World> {
  const root = tempDir('dh112-record-');
  let t = T0;
  const clock: Clock = { now: () => t, tick: (ms) => (t += ms) };
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  const readers: unknown = Reflect.get(adapters, 'transcriptReaders');
  const options: Parameters<typeof openRecord>[0] = { path: join(root, 'record', 'record.sqlite'), now: clock.now, evidence: store };
  const record = await openRecord(Object.assign(options, { readers }));
  return { clock, store, record };
}

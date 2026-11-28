import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { makeClock, T0, type LoadingRecord, type World } from '../723/helpers.ts';

export * from '../723/helpers.ts';

const roots: string[] = [];
export function removeRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export async function openWorld(start = T0): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), 'deep-learn-723-'));
  roots.push(root);
  const clock = makeClock(start);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  const readers: unknown = Reflect.get(adapters, 'transcriptReaders');
  const record = (await openRecord({ path: join(root, 'record', 'record.sqlite'), now: clock.now, evidence: store, ...({ readers } as object) })) as LoadingRecord;
  return { root, clock, store, record };
}

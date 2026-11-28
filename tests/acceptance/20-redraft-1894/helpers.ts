import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import * as adaptersEntry from '../../../packages/adapters/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore, type EvidenceStore, type PutResult, type TextSink, type Writer } from '../../../packages/evidence/src/index.ts';
import { openRecord, type RecordOptions } from '../../../packages/record/src/index.ts';
import { evidenceOf, ledgerOf, makeClock, tempDir, type Env, type World, type WorldOptions } from '../20/helpers.ts';

export * from '../20/helpers.ts';

export async function openWorld(o: WorldOptions = {}): Promise<World> {
  expect('transcriptReaders' in adaptersEntry, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  const readers = (adaptersEntry as unknown as { transcriptReaders?: readonly never[] }).transcriptReaders;
  const dir = o.home ? dirname(o.home) : tempDir('world');
  const home = o.home ?? join(dir, 'home');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  const clock = o.clock ?? makeClock();
  const env: Env = { HOME: home, ...o.env };
  const store = await openEvidenceStore({ root: evidenceOf(root), now: clock.now });
  const options: RecordOptions = { path: ledgerOf(root), now: clock.now, evidence: store };
  const record = await openRecord({ ...options, ...(readers && { readers }) } as RecordOptions);
  const asks = await openAsks({ record, now: clock.now, deliver: () => undefined });
  const w = { dir, home, root, env, clock, store, record, asks, writes: { count: 0 } } as World;
  w.archiveStore = counting(store, w);
  w.close = async () => { await record.close(); };
  return w;
}
function counting(store: EvidenceStore, w: World): EvidenceStore {
  const landed = (result: PutResult): PutResult => {
    if (result.status === 'stored') w.bend?.(result.evidence.sha256);
    return result;
  };
  return {
    ...store,
    connect(peer): Writer {
      const writer = store.connect(peer);
      return {
        async put(request) { w.writes.count++; return landed(await writer.put(request)); },
        async file(request) { w.writes.count++; return landed(await writer.file(request)); },
        text(request): TextSink {
          const sink = writer.text(request);
          return { write: (chunk) => sink.write(chunk), async close() { w.writes.count++; return landed(await sink.close()); } };
        },
      };
    },
  };
}

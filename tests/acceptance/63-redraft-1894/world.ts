import { join } from 'node:path';
import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { openArchive } from '../../../packages/archive/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Event } from '../../../packages/record/src/index.ts';
import { openRunner } from '../../../packages/runner/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import { openWiki } from '../../../packages/wiki/src/index.ts';
import { writeTranscript } from '../63/corpus.ts';
import { DAY, HOME, installFake, letters, tempDir, ulid, type Planted } from '../63/helpers.ts';
import { ARCHIVE, hookIn, readingModule, type Clock, type World } from '../63/world.ts';

export * from '../63/world.ts';

type RecordOptions = Parameters<typeof openRecord>[0];
type Readers = RecordOptions extends { readers?: infer R } ? R : undefined;

function makeClock(): Clock {
  let offset = 0;
  return { now: () => Date.now() + offset, advance: (ms) => { offset += ms; } };
}

export async function openWorld(o: { planted?: Planted[] } = {}): Promise<World> {
  const dir = tempDir('world');
  const root = join(dir, 'root');
  const agents = join(dir, 'agents');
  const fakeDir = join(dir, 'bin');
  installFake(fakeDir, { planted: o.planted ?? [] });
  const clock = makeClock();
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  const given = (): void => { expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true); };
  const readers = (adapters as { transcriptReaders?: Readers }).transcriptReaders;
  const options: RecordOptions & { readers?: Readers } = { path: join(root, 'ledger.db'), now: clock.now, evidence: store, ...(readers ? { readers } : {}) };
  const record = await openRecord(options);
  const asks = await openAsks({ record, now: clock.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: clock.now, price: async () => 0.5 });
  const sup = await openSupervisor({ record, asks, now: clock.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, resources: [] });
  const runner = await openRunner({
    record, asks, supervisor: sup, ledger, now: clock.now, root, loginPath: `${fakeDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    env: { HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
  });
  const wiki = await openWiki({ record, folder: join(root, 'wiki'), now: clock.now });
  const said = new Map<string, string>();
  const w: World = {
    dir, root, agents, fakeDir, clock, store, record, asks, ledger, sup, runner, wiki, said,
    plant: (planted) => { installFake(fakeDir, { planted }); },
    async seed(sessions) {
      for (const s of sessions) {
        const at = clock.now();
        await record.append(hookIn(letters(s.id), s.project), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: s.worktree, branch: 'main', thread: s.id } });
        writeTranscript(agents, s);
        for (const m of s.messages) said.set(`${s.handle}#${m.id}`, m.text);
      }
      const archive = await openArchive({ record, evidence: store, asks, adapters: adapters.shipped(), env: { HOME: agents }, connection: ARCHIVE, now: clock.now, held: () => [] });
      await archive.pass();
      await record.sync();
    },
    async reading() {
      given();
      const { openReading } = await readingModule();
      return openReading({ record, runner, root, wiki, now: clock.now });
    },
    async events(kinds) {
      given();
      const out: Event[] = [];
      for (let after = 0; ;) {
        const page = await record.read({ after, limit: 1000, ...(kinds && { kinds }) });
        if (!page.length) return out;
        out.push(...page);
        after = page[page.length - 1]!.log_pos;
      }
    },
    async close() {
      await runner.close();
      await sup.close();
      await record.close();
    },
  };
  return w;
}

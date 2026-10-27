// A reading that fails still ends on record (#63, invariant 2): when the runner refuses its job, run() rejects and one
// reading.finished says it failed and why. Real runner, record and fake agent from #63's acceptance world; only
// submit is wrapped, to fail as a closing runner does.
import { afterAll, expect, test } from 'vitest';
import type { Runner } from '@deepbuild/runner';
import { session } from '../../../tests/acceptance/63/corpus.ts';
import { cleanup } from '../../../tests/acceptance/63/helpers.ts';
import { dataOf, openWorld } from '../../../tests/acceptance/63/world.ts';
import { openReading } from '../src/index.ts';

afterAll(cleanup);

test('a reading whose job the runner refuses is recorded as failed, naming why', async () => {
  const w = await openWorld();
  try {
    const s = session(6302, { project: 'api', count: 4 });
    await w.seed([s]);
    const runner: Runner = Object.create(w.runner);
    runner.submit = async () => { throw Error('the runner is closed'); };
    const reading = await openReading({ record: w.record, runner, root: w.root, wiki: w.wiki, now: w.clock.now });
    await expect(reading.run({ kind: 'summary', handles: [s.handle], question: 'q' })).rejects.toThrow('the runner is closed');
    const finished = (await w.events(['reading.finished'])).map(dataOf);
    expect(finished.length).toBe(1);
    expect(finished[0]!.state).toBe('failed');
    expect(String(finished[0]!.invalid)).toContain('the runner is closed');
  } finally {
    await w.close();
  }
}, 60_000);

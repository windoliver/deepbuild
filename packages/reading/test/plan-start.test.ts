// #63 AC1's plan usage counts from before the job starts: the runner launches a job inside submit, so a window
// reading that lands while submit is still returning is already the job's use, never its baseline. Real runner,
// record and fake agent from #63's acceptance world; only submit is wrapped, to land that reading deterministically.
import { afterAll, expect, test } from 'vitest';
import type { Runner } from '@deepbuild/runner';
import { session } from '../../../tests/acceptance/63/corpus.ts';
import { ACCOUNT, cleanup } from '../../../tests/acceptance/63/helpers.ts';
import { openWorld } from '../../../tests/acceptance/63/world.ts';
import { openReading } from '../src/index.ts';

afterAll(cleanup);
const limits = (used: number, now: number) => ({ five_hour: { used_percentage: used, resets_at: Math.floor((now + 3 * 3_600_000) / 1000) } });

test('a reading landing while submit returns counts toward the job, not its baseline', async () => {
  const w = await openWorld();
  try {
    const s = session(6300, { project: 'api', count: 4 });
    await w.seed([s]);
    const report = (used: number) => w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(used, w.clock.now()) });
    await report(5);
    const runner: Runner = Object.create(w.runner);
    runner.submit = async (spec) => {
      const submitted = await w.runner.submit(spec);
      await report(6); // the job has started: this 1% is its own
      return submitted;
    };
    runner.wait = async (job) => {
      const rec = await w.runner.wait(job);
      setTimeout(() => void report(6), 200); // the reading after its end
      return rec;
    };
    const reading = await openReading({ record: w.record, runner, root: w.root, wiki: w.wiki, now: w.clock.now });
    const result = await reading.run({ kind: 'summary', handles: [s.handle], question: 'What does it say?' });
    expect(result.plan).toEqual({ five_hour_pct: 1 });
  } finally {
    await w.close();
  }
}, 60_000);

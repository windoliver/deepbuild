// An agent's answer never decides whether a reading is on record (#63, invariants 1 and 2): an answer the reading.answer
// contract refuses with hundreds of issues still ends in one reading.finished, its reason within the event's cap.
// Real runner, record and fake agent from #63's acceptance world.
import { afterAll, expect, test } from 'vitest';
import { session } from '../../../tests/acceptance/63/corpus.ts';
import { cleanup } from '../../../tests/acceptance/63/helpers.ts';
import { dataOf, openWorld, runReading } from '../../../tests/acceptance/63/world.ts';

afterAll(cleanup);

test('an invalid answer with 400 issues is still recorded as reading.finished, its reason capped', async () => {
  const s = session(6301, { project: 'api', count: 4 });
  const planted = Array.from({ length: 400 }, () => ({ text: 'x', cites: [{ at: `${s.handle}#m1`, quote: 'q' }], why: 1 }));
  const w = await openWorld({ planted: planted as never });
  try {
    await w.seed([s]);
    const { result } = await runReading(w, { kind: 'summary', handles: [s.handle], question: 'q' });
    const finished = (await w.events(['reading.finished'])).map(dataOf).filter((d) => d.reading === result.reading);
    expect(finished.length).toBe(1);
    expect(String(finished[0]!.invalid).length).toBeGreaterThan(0);
    expect(String(finished[0]!.invalid).length).toBeLessThanOrEqual(8192);
  } finally {
    await w.close();
  }
}, 60_000);

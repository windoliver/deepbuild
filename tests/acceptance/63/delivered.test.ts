// #63 AC6: every finding a reading job returns cites a handle delivered to it in that job; a finding that doesn't is
// dropped and counted.
import { afterAll, describe, expect, it } from 'vitest';
import { FACTS, session } from './corpus.ts';
import { AC, answerOf, cleanup } from './helpers.ts';
import { dataOf, openWorld, runReading } from './world.ts';

afterAll(cleanup);

describe(`AC6 ${AC[6]} every finding cites a handle delivered to it in that job; one that doesn't is dropped and counted`, () => {
  it('AC6 findings citing a session never delivered, a session delivered only to an earlier job, or no handle at all are dropped and counted', async () => {
    const [a, b, c] = [6000, 6001, 6002].map((seed) => session(seed, { project: 'api', count: 10 }));
    const w = await openWorld();
    try {
      await w.seed([a!, b!, c!]);
      // An earlier job is delivered A and C.
      const first = await runReading(w, { kind: 'summary', handles: [a!.handle, c!.handle], question: 'How does the api start?' });
      expect(first.result.findings.some((f) => f.cites.some((x) => x.at.startsWith(`${c!.handle}#`))), 'the earlier job read C').toBe(true);
      // This job is delivered A only; its agent's answer also cites B, C and nothing.
      const planted = [
        { text: 'planted: from B, never delivered', cites: [{ at: `${b!.handle}#m2`, quote: FACTS.api! }] },
        { text: 'planted: from C, delivered to the earlier job only', cites: [{ at: `${c!.handle}#m2`, quote: FACTS.api! }] },
        { text: 'planted: cites no handle', cites: [] },
      ];
      w.plant(planted);
      const { result, runs } = await runReading(w, { kind: 'summary', handles: [a!.handle], question: 'How does the api start?' });
      expect(w.said.get(`${b!.handle}#m2`), "each planted quote is at its handle: only delivery is wrong").toContain(FACTS.api);
      const texts = result.findings.map((f) => f.text);
      for (const p of planted) expect(texts, `dropped: ${p.text}`).not.toContain(p.text);
      expect(result.findings.length, "the job's own finding from A is kept").toBeGreaterThan(0);
      for (const f of result.findings) for (const x of f.cites) expect(x.at.startsWith(`${a!.handle}`), `${f.text} cites ${x.at}, delivered in this job`).toBe(true);
      const answered = runs.filter((r) => Number(answerOf(r.stdout)?.planted ?? 0) > 0).length;
      expect(answered, 'the agent answered with the planted findings').toBeGreaterThan(0);
      expect(result.undelivered, 'each finding citing no handle delivered in this job is counted').toBe(planted.length * answered);
      const finished = (await w.events(['reading.finished'])).find((e) => dataOf(e).reading === result.reading);
      expect(finished, `reading.finished records ${result.reading}`).toBeDefined();
      expect(dataOf(finished!).undelivered, 'the record keeps the count').toBe(result.undelivered);
    } finally {
      await w.close();
    }
  }, 900_000);
});

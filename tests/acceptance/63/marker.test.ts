// #63 AC9: a marker planted in a fixture transcript's message 900, which no delivered slice covers, appears in no
// prompt the reading job sent; a job that pastes the whole session fails, naming the job.
import { afterAll, describe, expect, it } from 'vitest';
import { markerProblems } from './checks.ts';
import { session, tag } from './corpus.ts';
import { AC, cleanup, repliesOf } from './helpers.ts';
import { pasteJob } from './wrong.ts';
import { openWorld, runReading } from './world.ts';

afterAll(cleanup);

describe(`AC9 ${AC[9]} a marker in message 900 that no delivered slice covers appears in no prompt the job sent`, () => {
  it("AC9 the reading job's prompts never hold the marker; (wrong program) a job pasting the whole session fails, naming the job", async () => {
    const marker = 'DH63MARKER0900QZX';
    const long = session(9000, { project: 'api', count: 1000, size: 300, texts: { 900: `${tag(9000, 900)} the release notes mention ${marker} once.` } });
    const m900 = `${long.handle}#m900`;
    const w = await openWorld();
    try {
      await w.seed([long]);
      expect(w.said.get(m900), 'message 900 holds the marker').toContain(marker);
      const { runs } = await runReading(w, { kind: 'summary', handles: [long.handle], question: 'What should be remembered from this session?' });
      const replies = runs.flatMap((r) => repliesOf(r.stdout));
      expect(replies.length, 'the job read slices of the session').toBeGreaterThan(0);
      for (const r of replies) {
        expect((r.slice?.messages ?? []).map((m: { at: string }) => m.at), `the slice ${r.args.handle} ${r.args.slice ?? ''} doesn't cover message 900`).not.toContain(m900);
      }
      expect(markerProblems(runs, marker), 'the reading job').toEqual([]);

      const pasted = await pasteJob(w, long.handle);
      const problems = markerProblems([pasted], marker);
      expect(problems.length, 'the pasting job sent the marker').toBeGreaterThan(0);
      expect(problems.join('\n'), 'the failure names the job').toContain(pasted.job);
    } finally {
      await w.close();
    }
  }, 900_000);
});

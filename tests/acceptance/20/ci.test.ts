// #20 AC6: a CI run's log and result are copied before the forge's retention deletes them, and read back intact. The
// forge is a fake of GitHub's Actions REST API on 127.0.0.1 (forge.ts), the one boundary mocked; its retention is the
// test's to run. Read back means through the record (a ci.archived event naming the run, its result and each job's
// log by hash) and the evidence store, after the forge answers 404 for the run.
import { afterAll, describe, expect, it } from 'vitest';
import { FakeForge, jobLog, type ForgeRun } from './forge.ts';
import { AC, allEvents, copyText, dataOf, DAY, HOUR, openArchiveOn, openWorld, removeTemps, T0, type Data } from './helpers.ts';

afterAll(removeTemps);

describe(`AC6 ${AC[6]} a CI run's log and result are copied before the forge's retention deletes them, and read back intact`, () => {
  it("AC6 a failed run of two jobs is copied while the forge holds it; after the forge's retention deletes it, its result and both jobs' logs read back intact from the archive", async () => {
    const forge = await FakeForge.start();
    const w = await openWorld();
    try {
      const run: ForgeRun = {
        repo: 'octo/shop', id: 731_904, name: 'CI', conclusion: 'failure', headSha: '4f6dec54f6dec54f6dec54f6dec54f6dec54f6de', created: T0 - 2 * HOUR,
        jobs: [
          { id: 2_201, name: 'test', conclusion: 'failure', log: jobLog(['##[group]Run npm test', '> shop@1.0.0 test', 'checkout total', '  1) adds tax to the total', '    AssertionError: expected 118 to equal 120', '11 passing', '1 failing', '##[error]Process completed with exit code 1.'], T0 - 2 * HOUR) },
          { id: 2_202, name: 'lint', conclusion: 'success', log: jobLog(['##[group]Run npm run lint', '> shop@1.0.0 lint', 'no problems found'], T0 - 2 * HOUR) },
        ],
      };
      forge.add(run);
      const archive = await openArchiveOn(w, { forge: { api: forge.api, repos: ['octo/shop'] } });
      await archive.pass();

      // Two days on, the forge's retention deletes the run: its routes answer 404.
      w.clock.set(T0 + 2 * DAY);
      forge.expire(run.id);
      const gone = await fetch(`${forge.api}/repos/octo/shop/actions/runs/${run.id}`);
      expect(gone.status, "the forge's retention deleted the run").toBe(404);

      const copies = (await allEvents(w.record, ['ci.archived'])).filter((e) => dataOf(e).repo === 'octo/shop' && String(dataOf(e).run) === String(run.id));
      expect(copies.length, `one ci.archived event names octo/shop run ${run.id}`).toBe(1);
      const data = dataOf(copies[0]!);
      expect(data.result, "the run's result, as the forge gave it").toBe('failure');
      const logs = (data.logs ?? []) as Data[];
      for (const job of run.jobs) {
        const entry = logs.find((l) => String(l.job) === String(job.id));
        expect(entry, `the event lists job ${job.id} (${job.name})'s log`).toBeDefined();
        expect(await copyText(w.store, String(entry!.evidence)), `job ${job.id} (${job.name})'s log reads back intact`).toBe(job.log);
      }
    } finally {
      await w.close();
      await forge.close();
    }
  }, 60_000);
});

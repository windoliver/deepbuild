// #2420's first two criteria: a run past 256 different targets. With #1106's sample stack up, 1,000 plain HTTP
// requests to the run's filter port, each under a different Host, are each answered 403; the record holds 256
// sandbox.denied events for the run naming a target, and after the run ends one more whose operation is `more` and
// whose target reads `744`. A second thousand under other names adds no event while the run lives, and the closing
// event reads `1744`. The stack is #1106's, the filter port the one its app's HTTPS_PROXY names (#2399's `filterOf`);
// the requests come from this process, outside the run. The run ends by `deep env down` in its worktree.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, downWorld, type Up, upWorld } from '../1106/helpers.ts';
import { filterOf } from '../2399/helpers.ts';
import { CEILING, endRun, namesFor, not403, reached, recordOf, sendAll, show } from './helpers.ts';

afterEach(cleanup, 60_000);

describe('a run past 256 different targets', () => {
  it('#2420.d74ef6aa 1,000 plain HTTP requests to the run\'s filter port, each under a different Host, are each answered 403; the record holds 256 sandbox.denied for the run naming a target, and after the run ends one more with operation more and target 744', async () => {
    let u: Up | undefined;
    try {
      u = await upWorld();
      const f = await filterOf(u.port);
      const names = namesFor('first', 1000);
      const answers = await sendAll(f, names);
      expect(answers.filter((a) => a !== 403).length, `each of the 1,000 requests is answered 403; not: ${not403(names, answers)}`).toBe(0);
      await reached(u.client, u.run, CEILING);
      const ended = await endRun(u.hub, u.client, u.wt, u.run, 60_000);
      expect(ended.code, '`deep env down` exits 0').toBe(0);
      expect(ended.cleaned, `the record holds run.cleaned for ${u.run}`).toBe(true);
      const rec = await recordOf(u.client, u.run);
      expect(rec.naming.length, `run ${u.run} recorded ${rec.naming.length} sandbox.denied naming a target, expected ${CEILING}: ${show(rec.naming)}`).toBe(CEILING);
      expect(rec.closing.map((d) => d.target), `after run ${u.run} ended, one sandbox.denied with operation more and target 744 (the 1,000 less ${CEILING}); the closing events: ${show(rec.closing)}`).toEqual(['744']);
    } finally {
      await downWorld(u);
    }
  }, 600_000);

  it('#2420.a7473ad6 a second thousand under other names adds no event while the run lives, and the closing event reads 1744', async () => {
    let u: Up | undefined;
    try {
      u = await upWorld();
      const f = await filterOf(u.port);
      const first = namesFor('one', 1000);
      const second = namesFor('two', 1000);
      const a1 = await sendAll(f, first);
      expect(a1.filter((a) => a !== 403).length, `each of the first 1,000 is answered 403; not: ${not403(first, a1)}`).toBe(0);
      await reached(u.client, u.run, CEILING);
      const full = (await recordOf(u.client, u.run)).naming.length;
      const a2 = await sendAll(f, second);
      expect(a2.filter((a) => a !== 403).length, `each of the second 1,000 is answered 403; not: ${not403(second, a2)}`).toBe(0);
      const ended = await endRun(u.hub, u.client, u.wt, u.run, 60_000);
      expect(ended.code, '`deep env down` exits 0').toBe(0);
      expect(ended.cleaned, `the record holds run.cleaned for ${u.run}`).toBe(true);
      const rec = await recordOf(u.client, u.run);
      const added = rec.naming.filter((d) => second.some((n) => d.target.includes(n)));
      expect(rec.naming.length, `run ${u.run} recorded ${rec.naming.length} sandbox.denied naming a target, expected ${CEILING} (${full} after the first thousand; the second thousand added ${added.length}: ${show(added)})`).toBe(CEILING);
      expect(added.length, `the second thousand added ${added.length} events to run ${u.run} while it lived`).toBe(0);
      expect(rec.closing.map((d) => d.target), `after run ${u.run} ended, one sandbox.denied with operation more and target 1744 (the 2,000 less ${CEILING}); the closing events: ${show(rec.closing)}`).toEqual(['1744']);
    } finally {
      await downWorld(u);
    }
  }, 600_000);
});

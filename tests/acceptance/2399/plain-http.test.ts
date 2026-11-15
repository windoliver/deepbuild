// #2399 AC1: with #1106's sample stack up, 100 identical plain HTTP requests sent to the run's filter port are each
// answered 403 and leave exactly one `sandbox.denied` for the run, with the operation `egress-plain-http` and that
// target. The stack is #1106's (its world, brought up by `deep env up` in a worktree); the filter's port is the one
// the app's own HTTPS_PROXY names; the requests come from this process, outside the run, as anything on this machine
// that finds the port would send them. On the merge base the record gains 100, and this test fails.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, downWorld, type Up, upWorld } from '../1106/helpers.ts';
import { denied, filterOf, gained, names, ofFilter, plain, settled, show, TIMES } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The one request, sent 100 times: `GET http://dh2399-plain.invalid/`, its target the host it names. */
const HOST = 'dh2399-plain.invalid';

describe('AC1 #2399.a0cbc7fe with #1106\'s sample stack up, 100 identical plain HTTP requests sent to the run\'s filter port are each answered 403 and leave exactly one sandbox.denied for the run, with the operation egress-plain-http and that target; on the merge base the record gains 100, and this test fails', () => {
  it('AC1 100 identical plain HTTP requests to the run\'s filter port are each answered 403, and the record gains exactly one sandbox.denied for the run: egress-plain-http, its target naming the request\'s host', async () => {
    let u: Up | undefined;
    try {
      u = await upWorld();
      const f = await filterOf(u.port);
      const before = await denied(u.client, u.run);
      const answers: (number | string)[] = [];
      for (let i = 0; i < TIMES; i++) answers.push(await plain(f, HOST));
      expect(answers.filter((a) => a !== 403), `each of the ${TIMES} requests is answered 403`).toEqual([]);
      expect(answers.length).toBe(TIMES);
      expect(await settled(u.client, f, u.run), 'a refusal of a target not seen before, sent after the 100, is in the record').toBe(true);
      const now = gained(before, await denied(u.client, u.run));
      const ours = now.filter(names('egress-plain-http', HOST));
      expect(ours.length, `the ${TIMES} identical requests leave exactly one sandbox.denied for the run ${u.run} with the operation egress-plain-http and the target ${HOST}; the record gained ${ours.length}`).toBe(1);
      expect(now.filter(ofFilter(HOST)).length, `and no other sandbox.denied for the run from its filter: ${show(now)}`).toBe(1);
    } finally {
      await downWorld(u);
    }
  }, 600_000);
});

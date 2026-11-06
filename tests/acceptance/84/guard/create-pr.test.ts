// #84 AC11: in a thread whose ask is "create PR", `git push origin HEAD` and `gh pr create` go through and `gh pr merge`
// is denied, naming the rule, with its authority ask filed. A second thread in the same repo, whose ask names neither,
// has its push denied: a request authorizes what it names in that thread. A rule that reads an ask as covering every
// effect (DEEP_HUB_PLANT=ask-covers-every-effect) lets the merge through and fails this test, naming the merge.
import { afterEach, describe, it } from 'vitest';
import {
  AC11, CREATE_PR, MERGE, PR_CREATE, PUSH, Session, allEvents, bash, cleanup, expectAllowed, expectAuthorityAsk, expectDenied, failureOf, makeWorld,
  must, startHub, stopHub, unasked, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

async function scenario(plant?: string): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  try {
    const s = new Session(w);
    s.hub = hub;
    await s.start();
    await s.typed(CREATE_PR);
    await expectAllowed(hub, s, bash(PUSH), AC11);
    await expectAllowed(hub, s, bash(PR_CREATE), AC11);
    const merge = await expectDenied(hub, s, bash(MERGE), AC11);
    await expectAuthorityAsk(hub, merge, AC11);

    const other = await unasked(hub, w);
    const thread = (id: string, events: Awaited<ReturnType<typeof allEvents>>) => events.find((e) => e.kind === 'session.start' && e.session === id)?.data.thread as unknown;
    const events = await allEvents(hub);
    must(thread(s.id, events) !== thread(other.id, events), `BLOCKED: ${AC11} the two sessions must be two threads: both are ${String(thread(s.id, events))}`);
    await expectDenied(hub, other, bash(PUSH), `${AC11} a request authorizes what it names in that thread; in another thread`);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC11} "create PR" covers the push and the PR, not the merge`, () => {
  it(`${AC11} ${PUSH} and ${PR_CREATE} go through, ${MERGE} is denied naming the rule with its ask filed, and another thread's push is denied`, async (ctx) => verdict(ctx, () => scenario()), 600_000);

  it(`${AC11} (wrong program) a rule that reads an ask as covering every effect (DEEP_HUB_PLANT=ask-covers-every-effect) lets the merge through and fails this test`, async (ctx) => verdict(ctx, async () => {
    const why = await failureOf(() => scenario('ask-covers-every-effect'));
    must(why !== null, `${AC11} the planted rule ask-covers-every-effect must fail this test; it passed`);
    must(why.includes(MERGE) && why.includes('must be denied'), `${AC11} the planted rule must fail this test on \`${MERGE}\` going through; it failed with: ${why}`);
  }), 600_000);
});

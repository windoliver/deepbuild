// #84 AC9: an unasked push, PR or merge is denied with the rule it breaks, and an asked one goes through.
//
// Unasked: you type a fix that names none of them. `git push origin HEAD`, `gh pr create` and `gh pr merge 12` are each
// denied naming a default entry, and an authority ask for each is filed (#22); your yes to the push's ask lets the same
// call run with no new ask, while the other two stay denied.
// Asked: "push this branch" lets the push through and, as a request authorizes exactly what it names, not the PR; a
// thread whose ask names the PR lets the push and the PR through, and once its claim is PASS and you type "merge PR 12",
// the merge naming that commit goes through.
import { afterEach, describe, it } from 'vitest';
import {
  AC9, MERGE, MERGE_ASK, PR_CREATE, PUSH, Session, approve, bash, cleanup, delivered, expectAllowed, expectAuthorityAsk, expectDenied, makeWorld,
  startHub, stopHub, unasked, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC9} an unasked push, PR or merge is denied with the rule it breaks, and an asked one goes through`, () => {
  it(`${AC9} in a thread whose ask names none of them, ${PUSH}, ${PR_CREATE} and ${MERGE} are each denied naming a default entry with an authority ask filed; your yes runs the same push`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = await unasked(hub, w);
      const push = await expectDenied(hub, s, bash(PUSH), AC9);
      const pr = await expectDenied(hub, s, bash(PR_CREATE), AC9);
      const merge = await expectDenied(hub, s, bash(MERGE), AC9);
      const ask = await expectAuthorityAsk(hub, push, AC9);
      await expectAuthorityAsk(hub, pr, AC9);
      await expectAuthorityAsk(hub, merge, AC9);
      await approve(w, ask, AC9);
      await expectAllowed(hub, s, bash(PUSH), `${AC9} after your yes to ask:${ask.id},`);
      await expectDenied(hub, s, bash(PR_CREATE), `${AC9} your yes to the push covers the push alone:`);
      await expectDenied(hub, s, bash(MERGE), `${AC9} your yes to the push covers the push alone:`);
    } finally {
      await stopHub(hub);
    }
  }), 600_000);

  it(`${AC9} an ask that names the push lets ${PUSH} through and not ${PR_CREATE}; an ask that names the PR lets both through; an ask that names the merge lets it through, naming the PASS's commit`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const pusher = new Session(w);
      pusher.hub = hub;
      await pusher.start();
      await pusher.typed('push this branch');
      await expectAllowed(hub, pusher, bash(PUSH), AC9);
      await expectDenied(hub, pusher, bash(PR_CREATE), `${AC9} a request authorizes exactly what it names:`);

      const s = new Session(w);
      const head = await delivered(hub, s, AC9);
      await s.typed(MERGE_ASK);
      await expectAllowed(hub, s, bash(`${MERGE} --match-head-commit ${head}`), AC9);
    } finally {
      await stopHub(hub);
    }
  }), 600_000);
});

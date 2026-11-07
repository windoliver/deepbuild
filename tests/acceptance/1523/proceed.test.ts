// #1523 AC7: `effect:send` reads `gh issue create`, as it reads `gh issue comment`. #321's planted sorter
// (DEEP_HUB_TEST_SORTER, README: A proceed) answers the agent's "want me to file the issue?" with "proceed"; in the turn
// that proceed starts, `gh issue create -t x` is held: it doesn't run, and an authority ask naming it is filed whose
// card names the send. `gh issue list`, a read, runs in the same turn with no ask.
import { afterEach, describe, it } from 'vitest';
import {
  AC7, ISSUE_CREATE, bash, cleanup, effectsNamed, expectAllowed, expectAuthorityAsk, expectDecided, expectProceed, cardOf, lastPos, makeWorld, must, replyText,
  shown, startHub, stopHub, tag, unasked, verdict, writeSorter,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const QUESTION = 'want me to file the issue?';

describe(`${AC7} no proceed covers gh issue create: it is a send`, () => {
  it(`${AC7} in the turn a planted sorter's proceed starts, ${ISSUE_CREATE} is held with an authority ask whose card names the send; gh issue list runs`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const rule = `planted-proceed-${tag()}`;
    const hub = await startHub(w, { sorter: writeSorter(w, rule, [QUESTION]) });
    try {
      const s = await unasked(hub, w);
      await s.read('src/auth.js');
      await expectProceed(hub, s, QUESTION, rule, AC7);
      await expectAllowed(hub, s, bash('gh issue list'), `BLOCKED: ${AC7} a read in the turn the proceed started:`);
      const since = await lastPos(hub);
      const r = await s.call(bash(ISSUE_CREATE));
      if (r.allowed) {
        await expectDecided(hub, r, ISSUE_CREATE, AC7);
        throw Error(`${AC7} \`${ISSUE_CREATE}\` must be held as a send in the turn a "proceed" started; deep-hook allowed it: ${shown(r.before)}`);
      }
      const ask = await expectAuthorityAsk(hub, { label: ISSUE_CREATE, text: replyText(r.before), rules: [], since }, AC7);
      const card = await cardOf(hub, ask);
      must(effectsNamed(card, ISSUE_CREATE).includes('send'), `${AC7} the card of ask:${ask.id}, holding \`${ISSUE_CREATE}\`, must name the send in its own words: ${JSON.stringify({ question: card.question, plan: card.plan, options: card.options }).slice(0, 900)}`);
    } finally {
      await stopHub(hub);
    }
  }), 900_000);
});

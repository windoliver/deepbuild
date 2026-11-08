// #1523 AC4: the computed-program table takes the new programs. With the hub up, in a thread whose prompts name no
// push, `"$(printf jj)" git push` is denied by `no-unreadable-push`, and the denial names what couldn't be read: the
// computed program, `$(printf jj)`. `"$(printf git)" push origin main`, which the base already denies so, is the control.
// AC8 (hubdown.test.ts) shows the same denial with the hub stopped; calls.test.ts shows the match in check mode.
import { afterEach, describe, it } from 'vitest';
import { AC4, UNREADABLE_JJ, bash, cleanup, each, expectDenied, makeWorld, must, startHub, stopHub, unasked, verdict } from './helpers.ts';

afterEach(cleanup, 60_000);

const RULE = 'no-unreadable-push';

describe(`${AC4} a jj push whose program the line computes is denied by ${RULE}`, () => {
  it(`${AC4} ${UNREADABLE_JJ} is denied by ${RULE}, naming $(printf jj), as "$(printf git)" push origin main is`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = await unasked(hub, w);
      await each([['"$(printf git)" push origin main', '$(printf git)'], [UNREADABLE_JJ, '$(printf jj)']], async ([command, computed]) => {
        const denied = await expectDenied(hub, s, bash(command!), AC4);
        must(denied.rules.includes(RULE), `${AC4} \`${command}\` must be denied by ${RULE}; its denial names ${denied.rules.join(', ')}: ${denied.text.slice(0, 600)}`);
        must(denied.text.includes(computed!), `${AC4} the denial of \`${command}\` must name what couldn't be read, ${computed}: ${denied.text.slice(0, 600)}`);
      });
    } finally {
      await stopHub(hub);
    }
  }), 600_000);
});

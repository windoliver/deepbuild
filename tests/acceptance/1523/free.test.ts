// #1523 AC3: the read-only forms of the same tools stay free. In a thread whose prompts name no push, PR or merge,
// `jj log`, `jj git fetch`, `gt log`, `gh api repos/acme/shop/pulls/3` and `gh api repos/acme/shop/pulls/3/merge` each
// go through with no ask. On the merge base the last is held as a merge (BASE-FAILURE.txt). A matcher that holds every
// call to these programs (DEEP_HUB_PLANT=holds-every-program, README: Wrong programs) fails this test, naming the call.
import { afterEach, describe, it } from 'vitest';
import { AC3, FREE, bash, cleanup, each, expectAllowed, failureOf, makeWorld, must, startHub, stopHub, unasked, verdict } from './helpers.ts';

afterEach(cleanup, 60_000);

async function scenario(plant?: string): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  try {
    const s = await unasked(hub, w);
    await each(FREE, (command) => expectAllowed(hub, s, bash(command), AC3));
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC3} the read-only forms of jj, gt and gh api go through`, () => {
  it(`${AC3} ${FREE.join(', ')} each go through with no ask, in a thread whose prompts name none of push, PR or merge`, async (ctx) => verdict(ctx, () => scenario()), 900_000);

  it(`${AC3} (wrong program) a matcher that holds every call to these programs (DEEP_HUB_PLANT=holds-every-program) fails this test, naming the call`, async (ctx) => verdict(ctx, async () => {
    const why = await failureOf(() => scenario('holds-every-program'));
    must(why !== null, `${AC3} the planted matcher holds-every-program must fail this test; it passed`);
    const named = FREE.filter((c) => why.includes(`\`${c}\` must go through`));
    must(named.length > 0, `${AC3} the planted matcher must fail this test naming a call it held (one of ${FREE.join(', ')}); it failed with: ${why}`);
  }), 900_000);
});

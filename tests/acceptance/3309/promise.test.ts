// #3309.c1997961: a promised check due for a session's next prompt, carried in a UserPromptSubmit reply that deep-hook
// let through without reading it, goes with that session's next prompt that reaches the model, exactly once.
//
// A Claude Code session in a repo: you type a prompt, and the agent stops promising to check the deploy again in
// 5 seconds (#120). The check comes due. Claude Code started the waiter at the stop, as setup's entries say, so the hub
// hands it the wake-up; this Claude Code starts no turn from a wake (../3305/README.md: How the continue comes to
// wait), so after the wake's grace the hub's rule applies: the check waits for the session's next prompt or stop, which
// the record says (`promise.due` with route `next_hook`). Were the waiter never handed it, the record says the same at
// once; either is accepted. You type a prompt with #906's planted late reply in place: the hub's reply to it, which
// carries the check, reaches deep-hook only after its hold ran out, so the prompt goes to the model without it. Then you
// type once more, as usual. Over the whole run's hook log the check must reach the agent exactly once, with that last
// prompt.
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, begin, cleanup, firedShown, makeHome, newSession, sleep, stop, waitFor } from '../83/helpers.ts';
import { firedCarries, lateHub, lostPrompt, modelPrompts, reached, reachedShown, typed } from '../3305/helpers.ts';
import { PROMISE } from './helpers.ts';

afterAll(cleanup, 60_000);

const FIRST = 'Deploy the fix and make sure it is up.';
const QUOTE = "I'll check the deploy again in 5 seconds.";
const LOST = 'Now add a test for total.ts.';
const NEXT = 'Then run the tests for total.ts.';

describe(`${PROMISE} A promised check carried in a prompt reply deep-hook never read goes with the session's next prompt that reaches the model, once`, () => {
  it(`${PROMISE} a check promised at a stop comes due and waits for the next prompt; it goes into "${LOST}"'s reply, which misses deep-hook's hold (the planted late reply); it reaches the agent exactly once, with "${NEXT}"`, async () => {
    const h = makeHome();
    const hub = await lateHub(h);
    const s = newSession(h, { remote: 'https://github.com/acme/widgets.git' });
    const claude = await begin(h, s, FIRST);
    await stop(claude, s, `The fix is deployed. ${QUOTE}`);
    const set = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'promise.set' && e.session === s.id), 30_000, `the record's promise.set for ${s.id}`);
    const id = String(set.data.promise);
    // The check's own words as the hub hands it (its wake-up text carries the promise's token, promise:<id>:<set>).
    const token = `promise:${id}:`;
    const waits = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'promise.due' && e.data?.promise === id && e.data?.route === 'next_hook'), 60_000, `the record's promise.due for ${id} with route next_hook (the check waits for the next prompt or stop)`);
    expect(modelPrompts(h, s), `the run's precondition: no turn started after the stop, so the check (${JSON.stringify(set.data.quote)}) waits for the session's next prompt`).toEqual([FIRST]);
    expect(reached(h, s, token), `the run's precondition: the promised check (${token}…) reached no agent before the late prompt`).toEqual([]);

    const lost = await lostPrompt(h, claude, s, LOST);
    expect(firedCarries(lost, token), `the run's precondition: with the planted late reply in place deep-hook printed nothing for "${LOST}", so the prompt went without the check: ${firedShown(lost)}`).toBe(false);
    expect(lost.model, `the run's precondition: "${LOST}" still reaches the model: ${firedShown(lost)}`).toBe(true);
    // Past the hub's late write (1 s after the 2 s hold): that reply reached no one.
    await sleep(2000);

    const next = await typed(claude, s, NEXT);
    expect(next.model, `"${NEXT}" reaches the model: ${firedShown(next)}`).toBe(true);
    const r = reached(h, s, token);
    const after = (await allEvents(hub)).filter((e) => e.kind.startsWith('promise.') && e.data?.promise === id).map((e) => ({ kind: e.kind, log_pos: e.log_pos, data: e.data }));
    expect(r.length, `the promised check ${id} (${JSON.stringify(set.data.quote)}, due and waiting since promise.due ${waits.id}), carried in "${LOST}"'s reply that deep-hook never read, must reach the agent exactly once over the run (not zero, not twice); hook replies carrying it: ${reachedShown(r)}; the record's promise events: ${JSON.stringify(after)}; prompts that reached the model: ${JSON.stringify(modelPrompts(h, s))}; "${NEXT}"'s reply: ${firedShown(next)}`).toBe(1);
    expect(r[0]!.prompt, `the check goes with the session's next prompt that reaches the model, "${NEXT}": ${reachedShown(r)}`).toBe(NEXT);
    await claude.end();
  }, 240_000);
});

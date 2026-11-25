// #3305.d2dd0332: a workspace notice carried in a UserPromptSubmit reply that deep-hook let through without reading it
// goes with that session's next prompt that reaches the model, exactly once.
//
// #2669's late run: a session outside any repo whose first task lands after its first prompt's reply has gone (Claude
// Code wrote the prompt's transcript entry after its hook fired, #567), so the hub tells the workspace notice to the
// session's next prompt that reaches the model. You type a work prompt with #906's planted late reply in place: the
// hub's reply to it, which the notice went into, reaches deep-hook only after its hold ran out, so the prompt goes to
// the model without it. Then you type once more, as usual. Over the whole run's hook log the workspace notice must
// reach the agent exactly once, with that last prompt.
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanup, Claude, edits, firedShown, makeHome, newSession, payload, sleep, stop, waitFor,
} from '../83/helpers.ts';
import { firedCarries as firedCarriesNotice, landed, NOTICE, promptBeforeEntry } from '../2669/helpers.ts';
import { firedCarries, lateHub, lostPrompt, modelPrompts, NOTICE_ID, reached, reachedShown, typed } from './helpers.ts';

afterAll(cleanup, 60_000);

const FIRST = 'Fix the cart total, then stop.';
const LOST = 'Now add a test for total.ts.';
const NEXT = 'Then run the tests for total.ts.';

describe(`${NOTICE_ID} A workspace notice carried in a prompt reply deep-hook never read goes with the session's next prompt that reaches the model, once`, () => {
  it(`${NOTICE_ID} a session outside any repo whose first task landed late: the workspace notice goes into "${LOST}"'s reply, which misses deep-hook's hold (the planted late reply); it reaches the agent exactly once, with "${NEXT}"`, async () => {
    const h = makeHome();
    const hub = await lateHub(h);
    const s = newSession(h);
    const claude = Claude.start(h);
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    const { fired, writeEntry } = await promptBeforeEntry(claude, s, FIRST);
    expect(firedCarriesNotice(fired), `the run's precondition: "${FIRST}"'s reply went before its task landed, so it carries no workspace notice: ${firedShown(fired)}`).toBe(false);
    writeEntry();
    await claude.initialize();
    await edits(claude, s);
    await waitFor(() => landed(hub, s), 60_000, `the record to show the workspace "${FIRST}"'s task landed in`);
    await stop(claude, s);
    expect(reached(h, s, NOTICE), `the run's precondition: the workspace notice ("${NOTICE}") reached no agent before the late prompt, so it waits for the session's next prompt that reaches the model`).toEqual([]);

    const lost = await lostPrompt(h, claude, s, LOST);
    expect(firedCarries(lost, NOTICE), `the run's precondition: with the planted late reply in place deep-hook printed nothing for "${LOST}", so the prompt went without the notice: ${firedShown(lost)}`).toBe(false);
    expect(lost.model, `the run's precondition: "${LOST}" still reaches the model: ${firedShown(lost)}`).toBe(true);
    // Past the hub's late write (1 s after the 2 s hold): that reply reached no one.
    await sleep(2000);

    const next = await typed(claude, s, NEXT);
    expect(next.model, `"${NEXT}" reaches the model: ${firedShown(next)}`).toBe(true);
    const r = reached(h, s, NOTICE);
    expect(r.length, `the workspace notice ("${NOTICE}"), carried in "${LOST}"'s reply that deep-hook never read, must reach the agent exactly once over the run (not zero, not twice); hook replies carrying it: ${reachedShown(r)}; prompts that reached the model: ${JSON.stringify(modelPrompts(h, s))}; "${NEXT}"'s reply: ${firedShown(next)}`).toBe(1);
    expect(r[0]!.prompt, `the notice goes with the session's next prompt that reaches the model, "${NEXT}": ${reachedShown(r)}`).toBe(NEXT);
    await claude.end();
  }, 240_000);
});

// #3305.bc1fc765: a continue waiting for a session's next prompt, carried in a UserPromptSubmit reply that deep-hook let
// through without reading it, goes with that session's next prompt that reaches the model, exactly once.
//
// A session in a repo: you type a prompt and its turn stops on a dropped connection (Claude Code's StopFailure,
// `server_error`), the service's to clear, so the core gives it its one automatic continue (#85). Claude Code starts
// the waiter at the StopFailure, as setup's entries say, and the hub hands the waiter the continue; this Claude Code
// starts no turn from the wake (README: How the continue comes to wait), so no turn shows it and the continue waits for
// the session's next prompt (the hub's rule for a continue a waiter took that no turn has shown, #85). Were no waiter
// there, the hub would park it for the next prompt the same way and say so in the record; either is accepted.
// You type again with #906's planted late reply in place: the hub's reply to that prompt, which the continue went
// into, reaches deep-hook only after its hold ran out, so the prompt goes to the model without it. Then you type once
// more, and that prompt goes to the model as usual. Over the whole run's hook log the continue must reach the agent
// exactly once, with that last prompt.
import { afterAll, describe, expect, it } from 'vitest';
import {
  allEvents, begin, cleanup, firedShown, makeHome, newSession, payload, readLines, sleep, waitFor,
} from '../83/helpers.ts';
import { CONTINUE, CONTINUE_WORDS, firedCarries, lateHub, lostPrompt, modelPrompts, reached, reachedShown, typed } from './helpers.ts';

afterAll(cleanup, 60_000);

const FIRST = 'Fix the cart total, then stop.';
const LOST = 'Go on with the cart total.';
const NEXT = 'Now add a test for total.ts.';
/** The record's word that a continue with no route open waits for the session's next prompt (#85). */
const PARKED = 'no route into it is open now';

describe(`${CONTINUE} A continue carried in a prompt reply deep-hook never read goes with the session's next prompt that reaches the model, once`, () => {
  it(`${CONTINUE} a transient stop's automatic continue, waiting for the next prompt, goes into "${LOST}"'s reply, which misses deep-hook's hold (the planted late reply); it reaches the agent exactly once, with "${NEXT}"`, async () => {
    const h = makeHome();
    const hub = await lateHub(h);
    const s = newSession(h, { remote: 'https://github.com/acme/widgets.git' });
    const claude = await begin(h, s, FIRST);
    // The turn you started stops on a dropped connection: Claude Code's StopFailure, no Stop.
    await claude.hook('StopFailure', payload(s, 'StopFailure', { error: 'server_error' }));
    const continued = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'session.continued' && e.session === s.id), 60_000, `the record's session.continued for ${s.id}`);
    expect(continued.data?.because, `the run's precondition: the stop on a dropped connection gets its one automatic continue: ${JSON.stringify(continued)}`).toBe('transient');
    // The continue waits for the next prompt: handed to the waiter, whose wake started no turn, or parked with no route open.
    const waiting = await waitFor(async () => {
      const wake = readLines(h.hookLog).find((l) => l.session === s.id && l.event === 'StopFailure' && l.phase === 'reply' && l.exit === 2 && String(l.stderr ?? '').includes(CONTINUE_WORDS));
      if (wake) return `the waiter's wake took it at ${wake.at} and no turn started from it`;
      const parked = (await allEvents(hub)).find((e) => e.kind === 'session.reading' && e.session === s.id && String(e.data?.reading ?? '').includes(PARKED));
      return parked ? `the record says: ${String(parked.data?.reading)}` : undefined;
    }, 30_000, `${s.id}'s continue to wait for its next prompt (the waiter's wake, or the record's reading that no route is open)`);
    expect(modelPrompts(h, s), `the run's precondition: no turn started after the stop (${waiting}), so the continue waits for the session's next prompt`).toEqual([FIRST]);
    expect(reached(h, s, CONTINUE_WORDS), `the run's precondition: the continue ("${CONTINUE_WORDS}") reached no agent before the late prompt`).toEqual([]);

    const lost = await lostPrompt(h, claude, s, LOST);
    expect(firedCarries(lost, CONTINUE_WORDS), `the run's precondition: with the planted late reply in place deep-hook printed nothing for "${LOST}", so the prompt went without the continue: ${firedShown(lost)}`).toBe(false);
    expect(lost.model, `the run's precondition: "${LOST}" still reaches the model: ${firedShown(lost)}`).toBe(true);
    // Past the hub's late write (1 s after the 2 s hold): that reply reached no one.
    await sleep(2000);

    const next = await typed(claude, s, NEXT);
    expect(next.model, `"${NEXT}" reaches the model: ${firedShown(next)}`).toBe(true);
    const r = reached(h, s, CONTINUE_WORDS);
    expect(r.length, `the automatic continue ("${CONTINUE_WORDS}", session.continued ${continued.id}), waiting for the next prompt (${waiting}) and carried in "${LOST}"'s reply that deep-hook never read, must reach the agent exactly once over the run (not zero, not twice); hook replies carrying it: ${reachedShown(r)}; prompts that reached the model: ${JSON.stringify(modelPrompts(h, s))}; "${NEXT}"'s reply: ${firedShown(next)}`).toBe(1);
    expect(r[0]!.prompt, `the continue goes with the session's next prompt that reaches the model, "${NEXT}": ${reachedShown(r)}`).toBe(NEXT);
    await claude.end();
  }, 240_000);
});

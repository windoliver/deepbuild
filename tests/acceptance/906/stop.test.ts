// AC2 #906.ac643af8 The same holds for an answer in a stop-hold reply that arrives after the hold.
//
// A session asks you through deep_ask; deep_ask comes back still waiting and the agent says it will wait. You answer
// while its turn still runs (no waiter yet), so the turn's Stop is held and its reply, a block carrying your answer,
// is the answer's route. The planted delay (README: Defined here) holds that reply past deep-hook's hold, so deep-hook
// gives up and the stop goes through without it. "The same holds" (README: Readings, 3): the answer reads stalled,
// never delivered; it goes with the session's next prompt, which is the wake's prompt if the hub hands it to the
// session's waiter and Claude Code wakes the session, else the prompt you type next; the transcript shows its ID once.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC2, answer, askingSession, assistantSays, cleanup, firedShown, lastPos, liftDelay, makeHome, makeRepo, outcomeList, outcomes,
  load, mustBeHeld, payload, plantDelay, replied, setup, showings, showingsShown, sleep, startHub, typedPrompt, within, type Fired,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC2} An answer in a stop-hold reply that arrives after the hold reads stalled, never delivered, and goes with the next prompt`, () => {
  it(`${AC2} the stop-hold reply carrying your answer misses deep-hook's hold (the planted delay): the ask reads stalled, never delivered; the next prompt carries it; the transcript shows its ID once`, async () => {
    const h = makeHome();
    const repo = makeRepo(h.home);
    const hub = await startHub(h);
    await setup(h.home);
    const a = await askingSession(hub, h.home, repo);
    await answer(hub, a);

    // The late stop: held for the answer waiting for it, and its reply written past the hold it acknowledged.
    plantDelay(h);
    let late: Fired;
    try {
      late = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
    } finally {
      liftDelay(h);
    }
    expect(Boolean(late.blocked) || replied(late).includes(a.id) || showings(a.s, a.id).length > 0,
      `${AC2} precondition, the planted delay (DEEP_HUB_TEST_LATE_REPLY, README: Defined here): with its file in place the hub's reply to this held stop must reach deep-hook only after its hold ran out, so the stop goes through without your answer to ${a.handle}; it was ${late.blocked ? `sent back: ${JSON.stringify(late.blocked).slice(0, 600)}` : 'let through'}, and the transcript shows ${a.handle} ${showings(a.s, a.id).length} time(s): ${firedShown(late)}`).toBe(false);
    mustBeHeld(late, `the late stop of ${a.s.id}`);
    await sleep(3000);
    const early = await outcomes(hub, a.id);
    expect(early.filter((e) => e.data?.outcome === 'delivered'),
      `${AC2} the stop-hold reply carrying ${a.handle} reached deep-hook after its hold ran out and the turn never showed it, so ${a.handle} must never read delivered (it is in flight, then stalled); outcomes: ${outcomeList(early)}`).toEqual([]);

    // The session's next prompt: a wake's, if Claude Code wakes the idle session with it, else the one you type.
    const since = await lastPos(hub);
    const wake = await within(30_000, () => a.claude.wakes.find((w) => w.session === a.s.id && !w.dropped && w.stderr.includes(a.id)));
    let next: Fired;
    if (wake) {
      next = wake.fired!;
      assistantSays(a.s, `Going with ${a.green}.`);
      await a.claude.hook('Stop', payload(a.s, 'Stop', { stop_hook_active: true, prompt_id: wake.promptId, last_assistant_message: `Going with ${a.green}.` }));
    } else {
      typedPrompt(a.s, 'Go on with the colour I picked.');
      next = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Go on with the colour I picked.' }));
      expect(showings(a.s, a.id).length,
        `${AC2} ${a.handle} must go with the session's next prompt, once: the transcript shows its ID in ${showingsShown(showings(a.s, a.id))}; the prompt's reply (${load()}): ${firedShown(next)}`).toBe(1);
      assistantSays(a.s, `Going with ${a.green}.`);
      await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: `Going with ${a.green}.` }));
    }

    await within(30_000, async () => (await outcomes(hub, a.id)).find((e) => e.data?.outcome === 'delivered'));
    await sleep(3000);
    const all = await outcomes(hub, a.id);
    expect(all.map((e) => `${e.data?.outcome} via ${e.data?.via}`),
      `${AC2} ${a.handle} must read stalled (the stop-hold reply deep-hook gave up on), then delivered once by the next prompt that showed it${wake ? ' (the wake\'s)' : ''}, and nothing else; outcomes: ${outcomeList(all)}`).toEqual(['stalled via stop_hold', 'delivered via next_prompt']);
    expect(all[1]!.log_pos > since, `${AC2} ${a.handle} reads delivered only once the next prompt carried it (after log_pos ${since}); outcomes: ${outcomeList(all)}`).toBe(true);
    expect(showings(a.s, a.id).length, `${AC2} the transcript shows ${a.handle} once: ${showingsShown(showings(a.s, a.id))}`).toBe(1);
  }, 400_000);
});

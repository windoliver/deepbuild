// AC1 #906.b7af9874 An answer handed in a UserPromptSubmit reply that reaches deep-hook after its hold ran out (a
// planted hub delay past the hold) is recorded stalled, never delivered, and goes with the session's next prompt; the
// transcript shows its ID once. A hub that records delivered when it writes the reply fails this test, naming the ask.
//
// A session asks you through deep_ask; deep_ask comes back still waiting and the agent says it will wait. You answer
// while its turn still runs (no Stop yet, so no waiter: the answer waits for the session's next prompt). You interrupt
// the turn and type a prompt (Claude Code runs no Stop hook for an interrupted turn); the hub's reply to that prompt,
// carrying your answer, is held past deep-hook's hold by the planted delay (README: Defined here), so deep-hook gives up
// and the prompt runs without it. Then you type again, and that turn ends with its Stop (README: Readings, 1 and 2).
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, answer, askingSession, assistantSays, cleanup, firedShown, lastPos, liftDelay, makeHome, makeRepo, outcomeList, outcomes,
  load, mustBeHeld, payload, plantDelay, replied, setup, showings, showingsShown, sleep, startHub, typedPrompt, within, type Fired,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC1} An answer in a UserPromptSubmit reply deep-hook gave up on reads stalled, never delivered, and goes with the next prompt`, () => {
  it(`${AC1} the prompt reply carrying your answer misses deep-hook's hold (the planted delay): the ask reads stalled, never delivered; the next prompt carries it; the transcript shows its ID once`, async () => {
    const h = makeHome();
    const repo = makeRepo(h.home);
    const hub = await startHub(h);
    await setup(h.home);
    const a = await askingSession(hub, h.home, repo);
    await answer(hub, a);

    // The late prompt: the hub's reply to it is written past the hold it acknowledged.
    typedPrompt(a.s, 'Which header colour did I pick?');
    plantDelay(h);
    let late: Fired;
    try {
      late = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Which header colour did I pick?' }));
    } finally {
      liftDelay(h);
    }
    expect(replied(late).includes(a.id) || showings(a.s, a.id).length > 0,
      `${AC1} precondition, the planted delay (DEEP_HUB_TEST_LATE_REPLY, README: Defined here): with its file in place the hub's reply to this prompt must reach deep-hook only after its hold ran out, so the prompt runs without your answer to ${a.handle}; deep-hook printed it and the transcript shows it ${showings(a.s, a.id).length} time(s): ${firedShown(late)}`).toBe(false);
    mustBeHeld(late, `the late prompt of ${a.s.id}`);
    // Past the hold and the hub's late write: the reply never reached the agent, so nothing says it was delivered.
    await sleep(3000);
    const early = await outcomes(hub, a.id);
    expect(early.filter((e) => e.data?.outcome === 'delivered'),
      `${AC1} the prompt reply carrying ${a.handle} reached deep-hook after its hold ran out and the turn never showed it, so ${a.handle} must never read delivered (it is in flight, then stalled); outcomes: ${outcomeList(early)}`).toEqual([]);

    // The session's next prompt carries it.
    const since = await lastPos(hub);
    typedPrompt(a.s, 'Go on with the colour I picked.');
    const next = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Go on with the colour I picked.' }));
    expect(showings(a.s, a.id).length,
      `${AC1} ${a.handle} must go with the session's next prompt, once: the transcript shows its ID in ${showingsShown(showings(a.s, a.id))}; the prompt's reply (${load()}): ${firedShown(next)}`).toBe(1);
    assistantSays(a.s, `Going with ${a.green}.`);
    await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: `Going with ${a.green}.` }));

    await within(30_000, async () => (await outcomes(hub, a.id)).find((e) => e.data?.outcome === 'delivered'));
    const all = await outcomes(hub, a.id);
    expect(all.map((e) => `${e.data?.outcome} via ${e.data?.via}`),
      `${AC1} ${a.handle} must read stalled (the prompt reply deep-hook gave up on), then delivered once by the next prompt that showed it, and nothing else; outcomes: ${outcomeList(all)}`).toEqual(['stalled via next_prompt', 'delivered via next_prompt']);
    expect(all[1]!.log_pos > since, `${AC1} ${a.handle} reads delivered only once the next prompt carried it (after log_pos ${since}); outcomes: ${outcomeList(all)}`).toBe(true);
    expect(showings(a.s, a.id).length, `${AC1} the transcript shows ${a.handle} once: ${showingsShown(showings(a.s, a.id))}`).toBe(1);
  }, 400_000);
});

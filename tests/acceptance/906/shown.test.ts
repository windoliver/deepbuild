// AC3 #906.02f9eada An answer whose ID a turn already shows is not sent again by a later route; a hub that sends it
// again shows it twice in the transcript and fails this test.
//
// A session asks you through deep_ask; deep_ask comes back still waiting and the agent says it will wait. You answer
// while its turn still runs; you interrupt and type a prompt, and the hub's reply to it carries your answer in time:
// deep-hook prints it and Claude Code shows it in the turn. Every later route then reads the session first and finds
// the ID there (README: Readings, 4): the turn's Stop isn't sent back with it, the waiter that Stop starts isn't handed
// it, and your next prompt doesn't carry it. The transcript shows its ID once and the record says delivered, once.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC3, answer, askingSession, assistantSays, cleanup, firedShown, makeHome, makeRepo, mustCarry, outcomeList, outcomes, payload, setup, showings,
  showingsShown, startHub, typedPrompt, within,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC3} An answer whose ID a turn already shows is not sent again by a later route`, () => {
  it(`${AC3} an answer the prompt's reply carried and the turn shows is not sent again by the stop hold, the waiter or the next prompt; the transcript shows its ID once`, async () => {
    const h = makeHome();
    const repo = makeRepo(h.home);
    const hub = await startHub(h);
    await setup(h.home);
    const a = await askingSession(hub, h.home, repo);
    await answer(hub, a);

    typedPrompt(a.s, 'Which header colour did I pick?');
    const first = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Which header colour did I pick?' }));
    mustCarry(first, a.id, `the prompt of ${a.s.id} after your answer to ${a.handle}`);
    expect(showings(a.s, a.id).length,
      `${AC3} precondition: the prompt's reply carries your answer to ${a.handle} in time and the turn shows its ID once: ${showingsShown(showings(a.s, a.id))}; the reply: ${firedShown(first)}`).toBe(1);

    // A later route: the turn's stop hold.
    assistantSays(a.s, `Going with ${a.green}.`);
    const stop = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: `Going with ${a.green}.` }));
    expect(showings(a.s, a.id).length,
      `${AC3} the turn already shows ${a.handle}: its stop hold must not send it again, yet the transcript shows it in ${showingsShown(showings(a.s, a.id))}; the stop's reply: ${firedShown(stop)}`).toBe(1);

    // Later routes: the waiter that stop started, then your next prompt.
    const woke = await within(15_000, () => a.claude.wakes.find((w) => w.session === a.s.id && w.stderr.includes(a.id)));
    expect(woke, `${AC3} the turn already shows ${a.handle}: the session's waiter must not be handed it again (it exited 2 with it)`).toBeUndefined();
    typedPrompt(a.s, 'Thanks. Anything else?');
    const next = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Thanks. Anything else?' }));
    expect(showings(a.s, a.id).length,
      `${AC3} the turn already shows ${a.handle}: your next prompt must not carry it again, yet the transcript shows it in ${showingsShown(showings(a.s, a.id))}; the prompt's reply: ${firedShown(next)}`).toBe(1);

    await within(30_000, async () => (await outcomes(hub, a.id)).find((e) => e.data?.outcome === 'delivered'));
    const all = await outcomes(hub, a.id);
    expect(all.map((e) => `${e.data?.outcome} via ${e.data?.via}`),
      `${AC3} ${a.handle} reads delivered once, by the prompt that carried it, and nothing else; outcomes: ${outcomeList(all)}`).toEqual(['delivered via next_prompt']);
  }, 400_000);
});

// #55 AC13, redrafted: in a Claude session run through paseo that deep-hook gates, your answer to the idle session
// arrives once: by deep-hook's wake route, or, where that route never fired in the session, by the plugin's prompt
// route on deep-hook's behalf; where neither fires, the session's row reads "answer waiting". Claude Code is #27's
// stand-in with `deep setup`'s real entries and waiter, started by paseo's daemon (fixtures/daemon.mjs), which hosts
// the real plugin (README, The world).
// First: what you gave the suite by hand, before ../29's helpers delete it (../55/README.md, Disputes D1).
import '../55/env.ts';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { appendTranscript, assistantSays, carries, payload } from '../27/helpers.ts';
import { answer, said, sessionRows, sleep, turnEnds, turnStarts, within } from '../55/helpers.ts';
import { AC13, answeredByWake, cleanup, delivered, idleInPaseo, stopWaiter, wakesOf } from './world.ts';

afterEach(cleanup, 120_000);

describe(`${AC13} In a Claude session run through paseo that deep-hook gates, an answer to the idle session arrives once`, () => {
  it(`${AC13} with deep-hook's waiter live, your answer wakes the session through it, once, and the plugin sends nothing`, async () => {
    await answeredByWake(await idleInPaseo());
  }, 400_000);

  it(`${AC13} where deep-hook's wake route never fired in the session, the plugin prompts the idle session with your answer on deep-hook's behalf, once`, async () => {
    const { home, paseo: { host }, f, a } = await idleInPaseo();
    await stopWaiter(a);
    await answer(home, a.handle, a.green.id);
    const sent = await within(30_000, () => host.callsOf(f, 'send').find((c) => carries(String(c.args?.text ?? ''), a.green)));
    expect(sent, `${AC13} ${a.handle}'s answer goes to ${a.s.id} as a prompt through paseo: the plugin sent ${JSON.stringify(host.callsOf(f, 'send'))}`).toBeDefined();
    expect({ status: sent!.status, into: sent!.into, interrupt: sent!.interrupt }, `${AC13} ${a.handle}'s answer goes in as a prompt to the idle session: no dialog, no interrupt`).toEqual({ status: 'idle', into: null, interrupt: false });
    // Paseo types the prompt into Claude Code, and the turn it starts goes as any prompt's does.
    const text = String(sent!.args.text);
    const words = `Going with ${a.green.label}.`;
    await turnStarts(host, f, 't2', text);
    a.s.prompt = randomUUID();
    appendTranscript(a.s, { type: 'user', promptId: a.s.prompt, message: { role: 'user', content: text }, promptSource: 'sdk' });
    await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: text }));
    assistantSays(a.s, words);
    await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: words }));
    await host.settled(await turnEnds(host, f, 't2', { words }));
    await within(20_000, async () => (await delivered(home, a)).length > 0);
    await sleep(5000);
    expect(host.callsOf(f, 'send').filter((c) => carries(String(c.args?.text ?? ''), a.green)).map((c) => c.args), `${AC13} the plugin sends ${a.handle}'s answer once`).toHaveLength(1);
    expect((await delivered(home, a)).map(said), `${AC13} ${a.handle} is delivered once`).toHaveLength(1);
    expect(wakesOf(a), `${AC13} and nothing woke ${a.s.id} besides`).toEqual([]);
  }, 400_000);

  it(`${AC13} where neither route fires, the session's row reads "answer waiting"`, async () => {
    const { home, paseo, f, a } = await idleInPaseo();
    await stopWaiter(a);
    await paseo.unloadPlugin();
    await answer(home, a.handle, a.green.id);
    const row = await within(30_000, async () => (await sessionRows(home)).find((r) => r.id === a.s.id && /answer waiting/i.test(JSON.stringify(r))));
    expect(row, `${AC13} with ${a.handle} answered and no route into it, ${a.s.id}'s row reads "answer waiting": ${JSON.stringify((await sessionRows(home)).find((r) => r.id === a.s.id))}`).toBeDefined();
    expect(wakesOf(a), `${AC13} nothing woke ${a.s.id}`).toEqual([]);
    expect(paseo.host.callsOf(f, 'send'), `${AC13} nothing was sent into ${a.s.id}`).toEqual([]);
  }, 400_000);
});

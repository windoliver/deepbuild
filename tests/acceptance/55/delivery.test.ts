// #55 AC13: in a Claude session run through paseo that deep-hook gates, your answer to the idle session arrives once:
// by deep-hook's wake route, or, where that route never fired in the session, by the plugin's prompt route on
// deep-hook's behalf; where neither fires, the session's row reads "answer waiting". The session is #27's Claude Code
// stand-in with `deep setup`'s entries, its waiter real; paseo is fixtures/paseo-host.mjs around the real plugin
// (README, The worlds).
import { afterEach, describe, expect, it } from 'vitest';
import {
  Claude, appendTranscript, assistantSays, beginAsk, carries, makeRepo, newSession, payload, setup, startHub, stopAfterAsking, typedPrompt, type Asking,
} from '../27/helpers.ts';
import { AC, Host, answer, cleanup, create, events, fakeAgent, makeHome, needPlugin, outcomesOf, said, sessionRows, sleep, turnEnds, turnStarts, waitFor, within, type Fake } from './helpers.ts';

afterEach(cleanup, 120_000);

/** A Claude session paseo runs and deep-hook gates: it asked you through deep_ask, stopped, and waits idle with its waiter live. */
async function idleInPaseo(): Promise<{ home: string; host: Host; f: Fake; a: Asking }> {
  needPlugin();
  const { home } = makeHome();
  const repo = makeRepo(home);
  const hub = await startHub(home, { noAskWait: true, shortHold: true });
  await setup(home);
  const host = await Host.start(home);
  const claude = Claude.start(home);
  const s = newSession(home, repo.dir);
  const f = fakeAgent('claude', repo.dir, s.id);
  await create(host, f);
  const prompt = 'Pick a header colour for the checkout page, then stop.';
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, prompt);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt }));
  await turnStarts(host, f, 't1', prompt);
  const a = await (await beginAsk(hub, home, { s, claude })).finish();
  const stop = await stopAfterAsking(a);
  if (stop.blocked) throw Error(`BLOCKED: nothing is answered yet, so ${s.id}'s stop goes through: ${stop.blocked}`);
  await host.settled(await turnEnds(host, f, 't1', { words: 'I asked which header colour you want; I will wait for your answer.' }));
  await waitFor(async () => (await claude.liveWaiters(s.id)).length > 0, 30_000, `the waiter of ${s.id}`).catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  return { home, host, f, a };
}
/** deep-hook's waiter for the session, stopped before it ever fires: in this session its wake route never fired. */
async function stopWaiter(a: Asking): Promise<void> {
  for (const w of await a.claude.liveWaiters(a.s.id)) try { process.kill(-w.pid, 'SIGKILL'); } catch { /* gone */ }
  await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length === 0, 10_000, `${a.s.id}'s waiter to be gone`);
}
const delivered = async (home: string, a: Asking) => outcomesOf(await events(home), a.handle).filter((e) => e.data?.outcome === 'delivered');

describe(`${AC[13]} In a Claude session through paseo that deep-hook gates, an answer to the idle session arrives once, by deep-hook's wake or the plugin's prompt on its behalf`, () => {
  it(`${AC[13]} with deep-hook's waiter live, your answer wakes the session through it, once, and the plugin sends nothing`, async () => {
    const { home, host, f, a } = await idleInPaseo();
    await answer(home, a.handle, a.green.id);
    const wake = await within(30_000, () => a.claude.wakes.find((w) => w.session === a.s.id && !w.dropped));
    expect(wake, `${AC[13]} ${a.handle}'s answer wakes ${a.s.id} through deep-hook's waiter`).toBeDefined();
    assistantSays(a.s, `Going with ${a.green.label}.`);
    await a.claude.hook('Stop', payload(a.s, 'Stop', { stop_hook_active: true, prompt_id: wake!.promptId, last_assistant_message: `Going with ${a.green.label}.` }));
    await within(20_000, async () => (await delivered(home, a)).length > 0);
    await sleep(5000);
    const sends = host.callsOf(f, 'send');
    expect(sends.map((c) => String(c.args?.text).slice(0, 200)), `${AC[13]} the plugin sends ${a.handle}'s answer nowhere while deep-hook's waiter delivers it: ${sends.length ? 'the answer went twice' : ''}`).toEqual([]);
    expect((await delivered(home, a)).map(said), `${AC[13]} ${a.handle} is delivered once`).toHaveLength(1);
  }, 400_000);

  it(`${AC[13]} where deep-hook's wake route never fired in the session, the plugin prompts the idle session with your answer on deep-hook's behalf, once`, async () => {
    const { home, host, f, a } = await idleInPaseo();
    await stopWaiter(a);
    await answer(home, a.handle, a.green.id);
    const sent = await within(30_000, () => host.callsOf(f, 'send').find((c) => carries(String(c.args?.text ?? ''), a.green)));
    expect(sent, `${AC[13]} ${a.handle}'s answer goes to ${a.s.id} as a prompt through paseo: the plugin sent ${JSON.stringify(host.callsOf(f, 'send'))}`).toBeDefined();
    expect(sent!.interrupt, `${AC[13]} a prompt to the idle session, never an interrupt`).toBe(false);
    // Paseo types the prompt into Claude Code: its turn starts with it, as any prompt's does.
    const text = String(sent!.args.text);
    appendTranscript(a.s, { type: 'user', promptId: `p-${a.id}`, message: { role: 'user', content: text }, promptSource: 'sdk' });
    a.s.prompt = `p-${a.id}`;
    await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: text }));
    assistantSays(a.s, `Going with ${a.green.label}.`);
    await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: `Going with ${a.green.label}.` }));
    await within(20_000, async () => (await delivered(home, a)).length > 0);
    await sleep(5000);
    expect(host.callsOf(f, 'send').filter((c) => carries(String(c.args?.text ?? ''), a.green)), `${AC[13]} the plugin sends ${a.handle}'s answer once`).toHaveLength(1);
    expect((await delivered(home, a)).map(said), `${AC[13]} ${a.handle} is delivered once`).toHaveLength(1);
    expect(a.claude.wakes.filter((w) => w.session === a.s.id), `${AC[13]} and no wake besides`).toEqual([]);
  }, 400_000);

  it(`${AC[13]} where neither route fires, the session's row reads "answer waiting"`, async () => {
    const { home, host, f, a } = await idleInPaseo();
    await stopWaiter(a);
    await host.stop();
    await answer(home, a.handle, a.green.id);
    const row = await within(30_000, async () => (await sessionRows(home)).find((r) => r.id === a.s.id && /answer waiting/i.test(JSON.stringify(r))));
    expect(row, `${AC[13]} session ${a.s.id}'s row reads "answer waiting": ${JSON.stringify((await sessionRows(home)).find((r) => r.id === a.s.id))}`).toBeDefined();
    expect(a.claude.wakes.filter((w) => w.session === a.s.id), `${AC[13]} nothing woke it`).toEqual([]);
    expect(host.callsOf(f, 'send'), `${AC[13]} nothing was sent`).toEqual([]);
  }, 400_000);
});

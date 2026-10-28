// AC1 #25.0215da31 A held stop continues with the answer.
//
// A session asks you a question through deep_ask, and its agent stops while the ask is open. Claude Code runs
// DeepBuild's Stop entries: the foreground one, which the hub holds, and the waiter in the background. You answer
// while the stop is held. The held stop's reply is Claude Code's `decision: block` with the answer as the reason, so
// the turn goes on with it (the stand-in writes "Stop hook feedback" into the transcript and the turn stays open, as
// #80 recorded); the turn's next Stop isn't held for it again, and the next prompt doesn't bring it a second time.
// The control: a Stop of a session that left no question is answered at once, with no decision (Scope: "only when
// the agent left a question").

import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, answer, askingSession, assistantSays, carries, cleanup, firedShown, makeHome, newSession, ours, payload, setup, sleep, startHub, typedPrompt,
  waitFor,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'answer-skips-held-stop';

async function scenario(plant?: string): Promise<void> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, { plant });
  await setup(home, env);

  // The control: a session that left no question stops, and its stop isn't held.
  const quiet = newSession(home);
  const other = Claude.start(home, env);
  await other.hook('SessionStart', payload(quiet, 'SessionStart'));
  typedPrompt(quiet, 'List the files here.');
  await other.hook('UserPromptSubmit', payload(quiet, 'UserPromptSubmit', { prompt: 'List the files here.' }));
  assistantSays(quiet, 'There are no files here.');
  const t0 = Date.now();
  const plain = await other.hook('Stop', payload(quiet, 'Stop', { last_assistant_message: 'There are no files here.' }));
  expect(plain.blocked, `AC1 a stop that left no question isn't sent back: ${firedShown(plain)}`).toBeUndefined();
  expect(Date.now() - t0, `AC1 a stop that left no question isn't held: ${firedShown(plain)}`).toBeLessThan(15_000);

  // The session asks, and stops with its ask open.
  const a = await askingSession(hub, home, env);
  let settled = false;
  const stopping = a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  void stopping.then(() => { settled = true; }, () => { settled = true; });
  await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter Claude Code started at ${a.s.id}'s Stop`);
  await sleep(2000);
  if (settled) throw Error(`AC1 the Stop of a session whose ask ${a.handle} is open must be held for your answer; it ended before you answered: ${firedShown(await stopping)}`);

  // You answer while the stop is held.
  await answer(home, a.handle, a.green.id, plant);
  const fired = await stopping;
  for (const r of ours(fired).filter((x) => !x.async)) {
    expect({ timedOut: r.timedOut, code: r.code }, `AC1 DeepBuild's Stop entry answers before Claude Code's timeout, exit 0: ${firedShown(fired)}`).toEqual({ timedOut: false, code: 0 });
  }
  if (!fired.blocked || !carries(fired.blocked, a.green)) {
    throw Error(`AC1 the held stop didn't continue with the answer: Claude Code's Stop got ${fired.blocked === undefined ? 'no decision: block' : `a block without ${a.green.label} (${a.green.id})`} for ${a.handle}: ${firedShown(fired)}`);
  }

  // The turn goes on with the answer, and its next stop isn't held for it again.
  assistantSays(a.s, `You chose ${a.green.label}; the header is green now.`);
  const t1 = Date.now();
  const next = await a.claude.hook('Stop', payload(a.s, 'Stop', { stop_hook_active: true, last_assistant_message: `You chose ${a.green.label}; the header is green now.` }));
  expect(next.blocked, `AC1 the answer goes back once: the continued turn's Stop isn't sent back with it again: ${firedShown(next)}`).toBeUndefined();
  expect(Date.now() - t1, `AC1 with the answer delivered, the continued turn's Stop isn't held: ${firedShown(next)}`).toBeLessThan(15_000);

  // Claimed once: the next prompt doesn't bring it a second time.
  typedPrompt(a.s, 'Now make the footer match.');
  const prompt = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Now make the footer match.' }));
  for (const r of ours(prompt).filter((x) => !x.async)) {
    expect(carries(r.stdout, a.green) && r.stdout.includes(a.id), `AC1 the answer the held stop delivered isn't given again at the next prompt: ${firedShown(prompt)}`).toBe(false);
  }
}

describe('AC1 #25.0215da31 A held stop continues with the answer', () => {
  it('AC1 #25.0215da31 an answer given while the stop is held comes back as that Stop\'s decision: block, the turn goes on with it, and it isn\'t delivered again', async () => {
    await scenario();
  }, 900_000);

  it(`AC1 #25.0215da31 (wrong program) a host that lets the held stop go and sends the answer another way (${PLANT}) fails this test`, async () => {
    let failure = '';
    try { await scenario(PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the held-stop check must fail on ${PLANT}`).toMatch(/AC1 the held stop didn't continue with the answer/);
  }, 900_000);
});

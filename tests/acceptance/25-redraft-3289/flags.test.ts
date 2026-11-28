import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  Claude, answer, ask, assistantSays, carries, cleanup, firedShown, makeHome, newSession, outcomes, NO_ASK_WAIT, pastHold, payload, said, setup, SHORT_HOLD, SHORT_HOLD_MS, startHub,
  typedPrompt, waitFor, type Hub,
} from '../25/fallbacks/helpers.ts';
import { blockedUnlessAsserted, seenWithin } from './helpers.ts';

afterAll(cleanup, 60_000);

const ONCE_BY_NEXT_PROMPT = ['next_prompt delivered'];
const NO_ROUTE_WATCH_MS = 5000;
const CONFIRMED_FROM_TRANSCRIPT_MS = 20_000;
const SECOND_DELIVERY_WATCH_MS = 3000;
const B_WAKE_MS = 15_000;

const deliveredRoutes = async (hub: Hub, handle: string): Promise<string[]> =>
  (await outcomes(hub, handle)).filter((o) => o.outcome === 'delivered').map((o) => `${o.via} ${o.outcome}`);

describe('AC5 #25.c5d6abef With the waiter\'s hook disabled for one session, its answers arrive through the next route, and a new session starts again from its declared flags', () => {
  it('AC5 #25.c5d6abef session A without its waiter gets your answer at its next prompt, once; session B in the same worktree, its waiter on, is woken by it', async () => {
    await blockedUnlessAsserted(waiterlessThenNewSession());
  }, 900_000);
});

async function waiterlessThenNewSession(): Promise<void> {
  const { home, tmp } = makeHome();
  const hub = await startHub(home, { ...NO_ASK_WAIT, ...SHORT_HOLD });
  await setup(home);
  const worktree = join(tmp, 'wt');

  const a = newSession(home, worktree);
  const ca = await Claude.start(home, { skip: ['asyncRewake'] });
  await ca.hook('SessionStart', payload(a, 'SessionStart'));
  typedPrompt(a, 'Pick the header colour, ask me if unsure.');
  await ca.hook('UserPromptSubmit', payload(a, 'UserPromptSubmit', { prompt: 'Pick the header colour, ask me if unsure.' }));
  await ca.initialize();
  const asked = await ask(hub, ca, a, 'green');
  await asked.reply;
  assistantSays(a, 'I asked which colour; waiting for your answer.');
  const stopA = await ca.hook('Stop', payload(a, 'Stop'));
  expect(stopA.stop?.blocked, `with nothing answered, A's held stop ends without a block (the control): ${firedShown(stopA)}`).toBe(false);
  expect((await ca.background()).filter((r) => r.asyncRewake), 'A\'s Claude Code ran no waiter: its hook is disabled for this session (the control)').toEqual([]);

  await pastHold(stopA, SHORT_HOLD_MS);
  await answer(home, asked.handle, asked.pick.id);
  const beforeNextPrompt = await seenWithin(async () => { const d = await deliveredRoutes(hub, asked.handle); return d.length ? d : undefined; }, NO_ROUTE_WATCH_MS, `a delivered outcome for ${asked.handle} before A's next prompt`);
  expect(beforeNextPrompt ?? [], `AC5 session ${a.id} has no route to take your answer to ${asked.handle} before its next prompt, so nothing may read delivered yet: ${JSON.stringify(await outcomes(hub, asked.handle))}`).toEqual([]);

  const nextPrompt = 'Anything from me?';
  typedPrompt(a, nextPrompt);
  const next = await ca.hook('UserPromptSubmit', payload(a, 'UserPromptSubmit', { prompt: nextPrompt }));
  const byNext = await seenWithin(async () => { const d = await deliveredRoutes(hub, asked.handle); return d.length ? d : undefined; }, CONFIRMED_FROM_TRANSCRIPT_MS, `a delivered outcome for ${asked.handle}`);
  expect(byNext ?? [], `AC5 session ${a.id} showed no waiter, so the waiter route is absent for it and your answer to ${asked.handle} (${asked.pick.label}) must arrive through the next route: its delivery outcome must read next_prompt delivered, once, by A's next prompt, and that delivery is missing; delivery outcomes ${JSON.stringify(await outcomes(hub, asked.handle))}; ${firedShown(next)}`).toEqual(ONCE_BY_NEXT_PROMPT);
  expect(said(next), `AC5 delivering the answer must not block your prompt: ${firedShown(next)}`).not.toMatch(/"decision"\s*:\s*"block"/);
  typedPrompt(a, 'Carry on.');
  const again = await ca.hook('UserPromptSubmit', payload(a, 'UserPromptSubmit', { prompt: 'Carry on.' }));
  expect(carries(said(again), asked), `AC5 the answer to ${asked.handle} is delivered once: A's prompt after it must not carry it again: ${firedShown(again)}`).toBe(false);
  const noLongerOnce = await seenWithin(async () => { const d = await deliveredRoutes(hub, asked.handle); return d.join() === ONCE_BY_NEXT_PROMPT.join() ? undefined : d; }, SECOND_DELIVERY_WATCH_MS, `another delivered outcome for ${asked.handle}`);
  expect(noLongerOnce ?? ONCE_BY_NEXT_PROMPT, `AC5 the answer to ${asked.handle} is delivered once: after A's prompt that follows, its delivery outcomes still read one next_prompt delivered`).toEqual(ONCE_BY_NEXT_PROMPT);

  const b = newSession(home, worktree);
  const cb = await Claude.start(home);
  await cb.hook('SessionStart', payload(b, 'SessionStart'));
  typedPrompt(b, 'Pick the footer colour, ask me if unsure.');
  await cb.hook('UserPromptSubmit', payload(b, 'UserPromptSubmit', { prompt: 'Pick the footer colour, ask me if unsure.' }));
  await cb.initialize();
  const askedB = await ask(hub, cb, b, 'blue');
  await askedB.reply;
  assistantSays(b, 'I asked which colour; waiting for your answer.');
  const stopB = await cb.hook('Stop', payload(b, 'Stop'));
  expect(stopB.stop?.blocked, `with nothing answered, B's held stop ends without a block (the control): ${firedShown(stopB)}`).toBe(false);
  const waiter = await waitFor(async () => (await cb.background()).find((r) => r.asyncRewake && r.ended === null), 20_000, 'B\'s waiter, started by Claude Code at B\'s stop');
  expect(waiter.asyncRewake, 'B\'s Claude Code runs DeepBuild\'s waiter (the control)').toBe(true);

  await pastHold(stopB, SHORT_HOLD_MS);
  await answer(home, askedB.handle, askedB.pick.id);
  const woke = await seenWithin(async () => (await cb.wakes()).find((w) => w.woke && w.prompt !== null && carries(w.prompt, askedB)), B_WAKE_MS, `B to be woken with ${askedB.handle}`);
  expect(woke, `AC5 session ${b.id} is a new session: it starts again from its declared flags, not from what session ${a.id} showed, so its waiter must wake it with your answer to ${askedB.handle} (${askedB.pick.label}) within 15 s; wakes seen: ${JSON.stringify(await cb.wakes())}`).toBeDefined();
}

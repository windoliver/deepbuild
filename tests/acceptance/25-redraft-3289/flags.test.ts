// AC5 #25.c5d6abef With the waiter's hook disabled for one session, its answers arrive through the next route, and a
// new session starts again from its declared flags.
//
// Redraft of ../25/fallbacks/flags.test.ts (README). Scope: "Delivery uses the session's own flags: a route counts only
// once this session has shown our hook firing for its event, on a version its facts cover; a route never seen working
// counts as absent and delivery takes the next one, and what a session has shown resets only when it starts again."
// And "each answer claimed once; delivery confirmed from the transcript"; "Added Oct 9": each delivery ends in an
// outcome, delivered and acknowledged among them.
//
// Session A's Claude Code runs no asyncRewake entry, so A never shows its waiter. A asks, stops (its stop is held and
// let go with no answer) and goes idle; you answer. With the waiter absent, the next route for an idle session is its
// next prompt: the record's delivery outcome for your answer reads `next_prompt` `delivered`, once, by A's next
// prompt, and nothing delivered it before that prompt. Then session B starts in the same worktree with the waiter's
// hook on: it starts from the routes your settings declare, its waiter fires at its stop, and your answer wakes it.
//
// What changed: A's delivery is read from the record's delivery outcome, not from text in A's hook reply. A reply can
// hold the option's id or label without delivering your answer (a rule line listing your saved decision does), so
// that text never counts as the delivery.

import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  Claude, answer, ask, assistantSays, carries, cleanup, firedShown, makeHome, newSession, outcomes, NO_ASK_WAIT, pastHold, payload, said, setup, SHORT_HOLD, SHORT_HOLD_MS, sleep, startHub,
  typedPrompt, waitFor,
} from '../25/fallbacks/helpers.ts';

afterAll(cleanup, 60_000);

const delivered = (all: { via?: string; outcome?: string }[]) => all.filter((o) => o.outcome === 'delivered');

describe('AC5 #25.c5d6abef With the waiter\'s hook disabled for one session, its answers arrive through the next route, and a new session starts again from its declared flags', () => {
  it('AC5 #25.c5d6abef session A without its waiter gets your answer at its next prompt, once; session B in the same worktree, its waiter on, is woken by it', async () => {
    const { home, tmp } = makeHome();
    const hub = await startHub(home, { ...NO_ASK_WAIT, ...SHORT_HOLD });
    await setup(home);
    const worktree = join(tmp, 'wt');

    // Session A: the waiter's hook disabled for this one session.
    const a = newSession(home, worktree);
    const ca = await Claude.start(home, { skip: ['asyncRewake'] });
    await ca.hook('SessionStart', payload(a, 'SessionStart'));
    typedPrompt(a, 'Pick the header colour, ask me if unsure.');
    await ca.hook('UserPromptSubmit', payload(a, 'UserPromptSubmit', { prompt: 'Pick the header colour, ask me if unsure.' }));
    await ca.initialize();
    const asked = await ask(hub, ca, a, 'green');
    await asked.reply; // the tool call ends ("still waiting") before the turn stops, as a real one does
    assistantSays(a, 'I asked which colour; waiting for your answer.');
    const stopA = await ca.hook('Stop', payload(a, 'Stop'));
    expect(stopA.stop?.blocked, `with nothing answered, A's held stop ends without a block (the control): ${firedShown(stopA)}`).toBe(false);
    expect((await ca.background()).filter((r) => r.asyncRewake), 'A\'s Claude Code ran no waiter: its hook is disabled for this session (the control)').toEqual([]);

    // You answer while A is idle; a route that worked would take it at once. A's has none but its next prompt.
    await pastHold(stopA, SHORT_HOLD_MS);
    await answer(home, asked.handle, asked.pick.id);
    await sleep(5000);
    const early = delivered(await outcomes(hub, asked.handle));
    expect(early, `AC5 session ${a.id} has no route to take your answer to ${asked.handle} before its next prompt, so nothing may read delivered yet: ${JSON.stringify(await outcomes(hub, asked.handle))}`).toEqual([]);

    const nextPrompt = 'Anything from me?';
    typedPrompt(a, nextPrompt);
    const next = await ca.hook('UserPromptSubmit', payload(a, 'UserPromptSubmit', { prompt: nextPrompt }));
    // Claude Code writes the reply's context into the transcript as the hook ends; the hub confirms it from there.
    const byNext = await waitFor(async () => { const d = delivered(await outcomes(hub, asked.handle)); return d.length ? d : undefined; }, 20_000, `a delivered outcome for ${asked.handle}`).catch(() => [] as { via?: string; outcome?: string }[]);
    expect(byNext.map((o) => `${o.via} ${o.outcome}`), `AC5 session ${a.id} showed no waiter, so the waiter route is absent for it and your answer to ${asked.handle} (${asked.pick.label}) must arrive through the next route: its delivery outcome must read next_prompt delivered, once, by A's next prompt, and that delivery is missing; delivery outcomes ${JSON.stringify(await outcomes(hub, asked.handle))}; ${firedShown(next)}`).toEqual(['next_prompt delivered']);
    expect(said(next), `AC5 delivering the answer must not block your prompt: ${firedShown(next)}`).not.toMatch(/"decision"\s*:\s*"block"/);
    typedPrompt(a, 'Carry on.');
    const again = await ca.hook('UserPromptSubmit', payload(a, 'UserPromptSubmit', { prompt: 'Carry on.' }));
    expect(carries(said(again), asked), `AC5 the answer to ${asked.handle} is delivered once: A's prompt after it must not carry it again: ${firedShown(again)}`).toBe(false);
    await sleep(3000);
    expect(delivered(await outcomes(hub, asked.handle)).map((o) => `${o.via} ${o.outcome}`), `AC5 the answer to ${asked.handle} is delivered once: after A's prompt that follows, its delivery outcomes still read one next_prompt delivered`).toEqual(['next_prompt delivered']);

    // Session B: new, in the same worktree, its waiter's hook on. It starts again from its declared flags.
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
    const woke = await waitFor(async () => (await cb.wakes()).find((w) => w.woke && w.prompt !== null && carries(w.prompt, askedB)), 15_000, `B to be woken with ${askedB.handle}`).catch(() => undefined);
    expect(woke, `AC5 session ${b.id} is a new session: it starts again from its declared flags, not from what session ${a.id} showed, so its waiter must wake it with your answer to ${askedB.handle} (${askedB.pick.label}) within 15 s; wakes seen: ${JSON.stringify(await cb.wakes())}`).toBeDefined();
  }, 900_000);
});

// AC9 #25.14a7bfb8 If the desktop app doesn't wake, the view says so and the answer falls back to the next prompt.
//
// The session runs in a Claude desktop app that doesn't wake (README: The Claude Code stand-in, `wakes: false`): its
// transcript entries say `entrypoint: "claude-desktop"`, it runs DeepBuild's waiter at the stop like any Claude Code,
// and when the waiter exits 2 with your answer it starts no turn and writes nothing. #80 recorded the desktop app
// waking (a UserPromptSubmit whose prompt is a task-notification carrying the waiter's stderr); this is the case where
// it doesn't. The view (README: The view) must say the session wasn't woken and that the answer goes at the next
// prompt; then the prompt you type carries the answer, once.

import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, answer, ask, assistantSays, carries, cleanup, firedShown, makeHome, newSession, outcomes, pastHold, payload, said, setup, startHub,
  typedPrompt, viewTexts, waitFor, eventually,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const saysNoWake = (text: string) => /wak|woke/i.test(text) && /next prompt/i.test(text);

describe('AC9 #25.14a7bfb8 If the desktop app doesn\'t wake, the view says so and the answer falls back to the next prompt', () => {
  it('AC9 #25.14a7bfb8 the waiter exits 2 with your answer, the desktop app starts no turn; the view says so and your next prompt carries the answer, once', async () => {
    const { home } = makeHome();
    const hub = await startHub(home);
    await setup(home);

    const s = { ...newSession(home), entrypoint: 'claude-desktop' };
    const app = await Claude.start(home, { wakes: false, entrypoint: 'claude-desktop' });
    await app.hook('SessionStart', payload(s, 'SessionStart'));
    typedPrompt(s, 'Choose the chart style, ask me if unsure.');
    await app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Choose the chart style, ask me if unsure.' }));
    await app.initialize();
    const asked = await ask(hub, app, s, 'bars');
    await asked.reply; // the tool call ends ("still waiting") before the turn stops
    assistantSays(s, 'I asked which style; waiting for your answer.');
    const stop = await app.hook('Stop', payload(s, 'Stop'));
    expect(stop.stop?.blocked, `with nothing answered, the held stop ends without a block (the control): ${firedShown(stop)}`).toBe(false);
    await waitFor(async () => (await app.background()).find((r) => r.asyncRewake && r.ended === null), 20_000, 'DeepBuild\'s waiter, started by the app at the stop');

    // You answer while the session is idle. The waiter takes it and exits 2; the app doesn't wake.
    await pastHold(stop);
    const shownBefore = new Set(await viewTexts(hub, s.id, asked.handle));
    await answer(home, asked.handle, asked.pick.id);
    const exited = await waitFor(async () => (await app.wakes()).find((w) => carries(w.stderr, asked)), 30_000, `DeepBuild's waiter to exit 2 with ${asked.handle}`).catch(() => undefined);
    expect(exited, `precondition: DeepBuild's waiter must take the answer to the idle session and exit 2 with it (the route that wakes an idle Claude Code session); waiter runs: ${JSON.stringify(await app.background())}`).toBeDefined();
    expect(exited!.woke, 'the desktop app started no turn (the control)').toBe(false);

    // The view says so.
    const fresh = async () => (await viewTexts(hub, s.id, asked.handle)).filter((text) => !shownBefore.has(text));
    const says = await eventually(async () => (await fresh()).some(saysNoWake), 60_000);
    expect(says, `AC9 the desktop app didn't wake, so the view must say so for session ${s.id} or ${asked.handle} (that it wasn't woken, and that the answer goes at the next prompt) within 60 s of the waiter's exit; what it shows since your answer: ${(await fresh()).join('\n').slice(0, 4000)}`).toBe(true);

    // The answer falls back to the next prompt.
    typedPrompt(s, 'Did you get my answer?');
    const next = await app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Did you get my answer?' }));
    expect(carries(said(next), asked), `AC9 your answer to ${asked.handle} (${asked.pick.label}) must fall back to the next prompt: DeepBuild's reply to it carries the answer; delivery outcomes ${JSON.stringify(await outcomes(hub, asked.handle))}; ${firedShown(next)}`).toBe(true);
    expect(said(next), `AC9 delivering the answer must not block your prompt: ${firedShown(next)}`).not.toMatch(/"decision"\s*:\s*"block"/);
    typedPrompt(s, 'Go on.');
    const again = await app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Go on.' }));
    expect(carries(said(again), asked), `AC9 the answer is delivered once: the prompt after it must not carry it again: ${firedShown(again)}`).toBe(false);
  }, 900_000);
});

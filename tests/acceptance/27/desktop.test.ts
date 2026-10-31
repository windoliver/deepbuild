// AC3 #27.f8331d25 The desktop app wakes too, or the fallback is recorded as a known limit.
//
// The desktop app's own wake is MANUAL.md: no harness drives the app (README: Readings, 3). This file proves the other
// half where it can be forced: a Claude Code that doesn't start a turn when the waiter exits 2 (the stand-in with
// `wake: false`, what the desktop app does when it doesn't wake). The fallback is recorded as a known limit when:
//   1. the record says so for the answer: its delivery reads `stalled`, never `delivered` from the waiter's exit
//      alone, and a reading on the session says it wasn't woken and the answer goes with the next prompt;
//   2. your next prompt carries the answer, once, and its delivery then reads delivered by the next prompt;
//   3. the limit stays known for the session: your next answer to it, given while it is idle again, isn't handed to
//      a waiter the session showed doesn't wake (no exit 2 with it, no second `stalled`); it waits for the next
//      prompt, which carries it once.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC3, Claude, about, allEvents, answer, assistantSays, beginAsk, carries, cleanup, firedShown, HOOK_KINDS, makeHome, makeRepo, outcomeList, outcomes,
  payload, replied, setup, startHub, stopAfterAsking, typedPrompt, waitFor, within, type Asking,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const saysNoWake = (text: string) => /\bwak|\bwoke/i.test(text) && /next prompt/i.test(text);

/** The session's stop after it asked, held while the ask is open, then let through: the session is idle. */
async function idle(a: Asking): Promise<void> {
  const fired = await stopAfterAsking(a);
  if (fired.blocked) throw Error(`BLOCKED: nothing is answered yet, so ${a.s.id}'s stop goes through: ${firedShown(fired)}`);
  await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter of ${a.s.id}`).catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
}

describe(`${AC3} The desktop app wakes too, or the fallback is recorded as a known limit`, () => {
  it(`${AC3} in an app that doesn't wake, the answer reads stalled with a reading on the session, your next prompt carries it once, and the session's next answer goes straight to its next prompt`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const app = Claude.start(home);
    await app.configure({ wake: false });

    // 1. Idle with an open ask; you answer; the waiter exits 2 with it; the app starts no turn.
    const first = await (await beginAsk(hub, home, { cwd: repo.dir, claude: app })).finish();
    const s = first.s;
    await idle(first);
    const since = (await allEvents(hub)).at(-1)!.log_pos;
    await answer(home, first.handle, first.green.id);
    const exited = await within(30_000, () => app.wakes.find((w) => w.session === s.id && carries(w.stderr, first.green)));
    expect(exited, `precondition: DeepBuild's waiter takes the answer to the idle session and exits 2 with it; waiter runs: ${JSON.stringify((await app.background()).map((r) => ({ code: r.code, stderr: r.stderr.slice(0, 200) })))}`).toBeDefined();
    expect(exited!.dropped, 'the app started no turn (the control)').toBe(true);
    const stalled = await within(60_000, async () => (await outcomes(hub, first.id)).find((e) => e.data?.outcome === 'stalled'));
    expect(stalled, `${AC3} the app didn't wake, so ${first.handle}'s delivery must read stalled within 60 s of the waiter's exit; outcomes: ${outcomeList(await outcomes(hub, first.id))}`).toBeDefined();
    expect((await outcomes(hub, first.id)).filter((e) => e.data?.outcome === 'delivered'), `${AC3} the waiter's exit alone never makes ${first.handle} delivered`).toEqual([]);
    const readings = (await allEvents(hub)).filter((e) => e.log_pos > since && !HOOK_KINDS.has(e.kind) && e.kind !== 'delivery.outcome' && about(e, s.id));
    expect(readings.some((e) => saysNoWake(JSON.stringify(e.data))), `${AC3} the record must say, on session ${s.id}, that it wasn't woken and the answer goes with the next prompt; what it recorded since your answer: ${JSON.stringify(readings.map((e) => ({ kind: e.kind, data: e.data }))).slice(0, 3000)}`).toBe(true);

    // 2. Your next prompt carries it, once.
    typedPrompt(s, 'Did my answer reach you?');
    const next = await app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Did my answer reach you?' }));
    expect(carries(replied(next), first.green), `${AC3} your answer to ${first.handle} (${first.green.label}) must come with your next prompt: ${firedShown(next)}`).toBe(true);
    const delivered = await within(10_000, async () => (await outcomes(hub, first.id)).find((e) => e.data?.outcome === 'delivered' && e.data?.via === 'next_prompt'));
    expect(delivered, `${AC3} ${first.handle} reads delivered by the next prompt once it came with it: ${outcomeList(await outcomes(hub, first.id))}`).toBeDefined();

    // 3. Same turn: the agent asks again and stops; idle again; you answer.
    assistantSays(s, `Got it: ${first.green.label}.`);
    const second = await (await beginAsk(hub, home, { claude: app, s })).finish();
    await idle(second);
    await answer(home, second.handle, second.green.id);
    const handed = await within(15_000, () => app.wakes.find((w) => w.session === s.id && carries(w.stderr, second.green)));
    expect(handed, `${AC3} session ${s.id} showed its app doesn't wake, a known limit: your answer to ${second.handle} must not be handed to its waiter again (it exited 2 with it)`).toBeUndefined();
    expect((await outcomes(hub, second.id)).filter((e) => e.data?.outcome === 'stalled'), `${AC3} a known limit isn't tried again: ${second.handle} must not read stalled`).toEqual([]);
    typedPrompt(s, 'And the second one?');
    const later = await app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'And the second one?' }));
    expect(carries(replied(later), second.green), `${AC3} your answer to ${second.handle} (${second.green.label}) comes with the next prompt: ${firedShown(later)}`).toBe(true);
    expect(carries(replied(later), first.green), `${AC3} ${first.handle} was delivered once; it doesn't come again: ${firedShown(later)}`).toBe(false);
  }, 600_000);
});

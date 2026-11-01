// #27.f8331d25 The desktop app wakes too, or the fallback is recorded as a known limit (AC3), blind redraft.
//
// Whether the desktop app itself wakes is the earlier suite's MANUAL.md: no harness drives the app. This file proves
// the other branch wherever an app doesn't wake, on the real hub, deep-hook, waiter and `deep inbox answer`, with the
// earlier suite's Claude Code stand-in configured as an app that starts no turn when the waiter exits 2
// (`configure({ wake: false })`). README: Readings.
//
//   1. You answer an idle session's ask. The waiter takes it and exits 2; the app starts no turn. The delivery reads
//      `stalled` and never `delivered`, since no turn showed it, and the record says on the session that it wasn't
//      woken and the answer goes with its next prompt: the fallback, recorded.
//   2. Your next prompt carries that answer, and the record then reads it delivered.
//   3. The limit stays known for the session (design: a route never seen working counts as absent, and what a session
//      has shown resets only when it starts again): the same session asks again, goes idle with a live waiter, and you
//      answer. That answer isn't handed to the waiter (no exit 2 carrying it), reads neither stalled nor delivered
//      before a prompt shows it, and your next prompt carries it, without the first answer again.
//
// Each check reads only what its own step caused: an answer is matched by its own option's label, which carries a
// fresh tag (never by the option IDs `blue` and `green`, which every ask shares), waiter exits by when they happened,
// and record events by their log position past a mark taken just before the step.
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, HOOK_KINDS, about, allEvents, answer, assistantSays, beginAsk, cleanup, firedShown, makeHome, makeRepo, outcomeList, outcomes,
  payload, replied, setup, startHub, stopAfterAsking, typedPrompt, waitFor, within, type Asking, type Ev, type Hub,
} from '../helpers.ts';

afterAll(cleanup, 60_000);

const ID = '#27.f8331d25';
/**
 * Whether a text carries the answer you gave to an ask: the label of the option you chose, unique to that ask, or the
 * ask's handle with the chosen option's ID on the same line.
 */
const carriesAnswer = (text: string, a: Asking) => text.includes(a.green.label) || new RegExp(`${a.handle}[^\\n]*\\b${a.green.id}\\b`).test(text);
/** Whether a text names an ask's answer at all: its handle or its chosen label. */
const names = (text: string, a: Asking) => text.includes(a.handle) || text.includes(a.green.label);
/** A reading that says the session wasn't woken and that the answer goes with its next prompt. */
const saysNotWoken = (text: string) => /\b(wak|woke)/i.test(text) && /next prompt/i.test(text);
/** The newest log position: a mark taken before a step, so its checks read only what came after. */
const mark = async (hub: Hub) => (await allEvents(hub)).at(-1)?.log_pos ?? 0;
const after = (evs: Ev[], pos: number) => evs.filter((e) => e.log_pos > pos);
const is = (outcome: string) => (e: Ev) => e.data?.outcome === outcome;

/** The session's stop after it asked: nothing is answered, so the stop goes through and its waiter is left waiting. */
async function goIdle(a: Asking, since: number): Promise<void> {
  const fired = await stopAfterAsking(a);
  if (fired.blocked) throw Error(`${ID} BLOCKED: nothing is answered yet, so ${a.s.id}'s stop must go through: ${firedShown(fired)}`);
  await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).some((r) => r.started >= since) || undefined, 30_000, `a waiter of ${a.s.id} started at this stop`)
    .catch((e: Error) => { throw Error(`${ID} BLOCKED: ${e.message}`); });
}

describe(`${ID} The desktop app wakes too, or the fallback is recorded as a known limit`, () => {
  it(`${ID} in an app that doesn't wake, the answer reads stalled and the session's record says it goes with the next prompt; the next prompt carries it; the session's next answer goes straight to its next prompt`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home, { noAskWait: true, shortHold: true });
    await setup(home);
    const app = Claude.start(home);
    await app.configure({ wake: false });

    // ---- Step 1: an idle session's answer, handed to a waiter whose app starts no turn.
    const t0 = Date.now();
    const first = await (await beginAsk(hub, home, { cwd: repo.dir, claude: app })).finish();
    const s = first.s;
    await goIdle(first, t0);
    const m1 = await mark(hub);
    const t1 = Date.now();
    await answer(home, first.handle, first.green.id);
    const exited = await within(30_000, () => app.wakes.find((w) => w.session === s.id && w.at >= t1 && names(w.stderr, first)));
    expect(exited, `${ID} precondition: the waiter takes your answer to ${first.handle} (${first.green.label}) to the idle session and exits 2 with it, as it does in a terminal (AC1); waiter runs: ${JSON.stringify((await app.background()).map((r) => ({ started: r.started, code: r.code, stderr: r.stderr.slice(0, 300) })))}`).toBeDefined();
    expect(exited!.dropped, `${ID} precondition: the app started no turn for the waiter's exit`).toBe(true);
    const stalled = await within(60_000, async () => after(await outcomes(hub, first.id), m1).find(is('stalled')));
    expect(stalled, `${ID} step 1: no turn showed your answer to ${first.handle}, so its delivery must read stalled within 60 s of the waiter's exit; outcomes: ${outcomeList(await outcomes(hub, first.id))}`).toBeDefined();
    const notWoken = await within(10_000, async () => after(await allEvents(hub), m1)
      .find((e) => about(e, s.id) && !HOOK_KINDS.has(e.kind) && e.kind !== 'delivery.outcome' && saysNotWoken(JSON.stringify(e.data))));
    expect(notWoken, `${ID} step 1: the record must say, on session ${s.id}, that it wasn't woken and that your answer goes with its next prompt; it recorded since your answer: ${JSON.stringify(after(await allEvents(hub), m1).filter((e) => !HOOK_KINDS.has(e.kind)).map((e) => ({ kind: e.kind, session: e.session, data: e.data }))).slice(0, 3000)}`).toBeDefined();

    // ---- Step 2: your next prompt carries it, and only then does it read delivered.
    const m2 = await mark(hub);
    expect((await outcomes(hub, first.id)).filter(is('delivered')), `${ID} step 1: the waiter's exit alone never makes ${first.handle} delivered; no turn showed it`).toEqual([]);
    typedPrompt(s, 'Did my answer reach you?');
    const next = await app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Did my answer reach you?' }));
    expect(carriesAnswer(replied(next), first), `${ID} step 2: your answer to ${first.handle} (${first.green.label}) must come with the session's next prompt; DeepBuild replied: ${firedShown(next)}`).toBe(true);
    const delivered = await within(10_000, async () => after(await outcomes(hub, first.id), m2).find(is('delivered')));
    expect(delivered, `${ID} step 2: ${first.handle} must read delivered once the prompt carried it; outcomes: ${outcomeList(await outcomes(hub, first.id))}`).toBeDefined();

    // ---- Step 3: the same session asks again and goes idle with a live waiter; you answer.
    assistantSays(s, `Got it: ${first.green.label}.`);
    const t2 = Date.now();
    const second = await (await beginAsk(hub, home, { claude: app, s })).finish();
    await goIdle(second, t2);
    const m3 = await mark(hub);
    const t3 = Date.now();
    await answer(home, second.handle, second.green.id);
    const handedSoon = await within(15_000, () => app.wakes.find((w) => w.session === s.id && w.at >= t3 && names(w.stderr, second)));
    expect(handedSoon, `${ID} step 3: session ${s.id} showed its app doesn't wake, so your answer to ${second.handle} (${second.green.label}) must not be handed to its waiter, which exited 2 with it`).toBeUndefined();
    const early = after(await outcomes(hub, second.id), m3);
    expect(early.filter((e) => is('stalled')(e) || is('delivered')(e)), `${ID} step 3: with the limit known, ${second.handle} isn't tried on the waiter (no stalled) and nothing has shown it yet (no delivered): ${outcomeList(early)}`).toEqual([]);

    const m4 = await mark(hub);
    typedPrompt(s, 'And my second answer?');
    const later = await app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'And my second answer?' }));
    expect(carriesAnswer(replied(later), second), `${ID} step 3: your answer to ${second.handle} (${second.green.label}) must come with the session's next prompt; DeepBuild replied: ${firedShown(later)}`).toBe(true);
    expect(carriesAnswer(replied(later), first), `${ID} step 2: ${first.handle} was delivered at the prompt before; it must not come again: ${firedShown(later)}`).toBe(false);
    const deliveredSecond = await within(10_000, async () => after(await outcomes(hub, second.id), m4).find(is('delivered')));
    expect(deliveredSecond, `${ID} step 3: ${second.handle} must read delivered once the prompt carried it; outcomes: ${outcomeList(await outcomes(hub, second.id))}`).toBeDefined();
    expect(app.wakes.filter((w) => w.session === s.id && w.at >= t3 && names(w.stderr, second)), `${ID} step 3: no waiter exited 2 with your answer to ${second.handle} at any time`).toEqual([]);
    expect((await outcomes(hub, second.id)).filter(is('stalled')), `${ID} step 3: ${second.handle} never reads stalled`).toEqual([]);
  }, 900_000);
});

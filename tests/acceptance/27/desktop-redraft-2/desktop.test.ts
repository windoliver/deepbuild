// #27.f8331d25 The desktop app wakes too, or the fallback is recorded as a known limit (AC3), second blind redraft.
//
// Whether the desktop app itself wakes is ../MANUAL.md: no harness drives the app. This file proves the other branch
// wherever an app doesn't wake, on the real hub, deep-hook, waiter and `deep inbox answer`, with this folder's Claude
// Code stand-in configured as an app that starts no turn when the waiter exits 2 (`configure({ wake: false })`). The
// stand-in writes each hook reply's added context into the transcript as Claude Code does, and the turns it runs end
// with their Stop, so a hub that confirms a delivery from the transcript (design: "delivered and acknowledged, when
// the agent's next prompt or turn shows it") is read once the turn has shown it, with a bounded wait (README).
//
//   1. You answer an idle session's ask. The waiter takes it and exits 2; the app starts no turn. The delivery reads
//      `stalled`, never `delivered`, and the record says on the session that it wasn't woken and the answer goes with
//      its next prompt.
//   2. Your next prompt carries that answer; Claude Code writes it into the transcript; the turn ends. It then reads
//      delivered, once.
//   3. The limit stays known for the session: you type again, the agent asks again and the session goes idle with a
//      live waiter; you answer. That answer isn't handed to the waiter, reads neither stalled nor delivered before a
//      prompt shows it, and your next prompt carries it, without the first answer again; it then reads delivered.
import { afterAll, describe, expect, it } from 'vitest';
import {
  HOOK_KINDS, about, allEvents, answer, assistantSays, firedShown, makeHome, makeRepo, outcomeList, outcomes, payload, replied, setup, sleep,
  startHub, typedPrompt, waitFor, within, type Ev, type Hub, type Session,
} from '../helpers.ts';
import { Claude, beginAsk, cleanup, contextEntries, stopAfterAsking, type Asking } from './standin.ts';

afterAll(cleanup, 60_000);

const ID = '#27.f8331d25';
/** Whether a text carries your answer to an ask: the chosen option's label (a fresh tag per ask), or the ask's handle with the chosen ID on one line. */
const carriesAnswer = (text: string, a: Asking) => text.includes(a.green.label) || new RegExp(`${a.handle}[^\\n]*\\b${a.green.id}\\b`).test(text);
/** Whether a text names an ask's answer at all. */
const names = (text: string, a: Asking) => text.includes(a.handle) || text.includes(a.green.label);
const saysNotWoken = (text: string) => /\b(wak|woke)/i.test(text) && /next prompt/i.test(text);
const mark = async (hub: Hub) => (await allEvents(hub)).at(-1)?.log_pos ?? 0;
const after = (evs: Ev[], pos: number) => evs.filter((e) => e.log_pos > pos);
const is = (outcome: string) => (e: Ev) => e.data?.outcome === outcome;

/** The stop after asking goes through with nothing answered, and a waiter started at it is live (else BLOCKED). */
async function goIdle(a: Asking, since: number): Promise<void> {
  const fired = await stopAfterAsking(a);
  if (fired.blocked) throw Error(`${ID} BLOCKED: nothing is answered yet, so ${a.s.id}'s stop must go through: ${firedShown(fired)}`);
  await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).some((r) => r.started >= since) || undefined, 30_000, `a waiter of ${a.s.id} started at this stop`)
    .catch((e: Error) => { throw Error(`${ID} BLOCKED: ${e.message}`); });
}
/** You type a prompt; Claude Code runs UserPromptSubmit and writes what DeepBuild's reply adds into the transcript. */
async function prompt(app: Claude, s: Session, text: string) {
  typedPrompt(s, text);
  return app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
}
/** The turn ends: the agent's words, then its Stop. */
const endTurn = (app: Claude, s: Session, words: string) => { assistantSays(s, words); return app.hook('Stop', payload(s, 'Stop', { last_assistant_message: words })); };

describe(`${ID} The desktop app wakes too, or the fallback is recorded as a known limit`, () => {
  it(`${ID} in an app that doesn't wake, the answer reads stalled with a reading on the session; the next prompt carries it and, once the turn shows it, it reads delivered; the session's next answer goes straight to its next prompt`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
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
    expect(exited, `${ID} precondition: the waiter takes your answer to ${first.handle} (${first.green.label}) and exits 2 with it; waiter runs: ${JSON.stringify((await app.background()).map((r) => ({ started: r.started, code: r.code, stderr: r.stderr.slice(0, 300) })))}`).toBeDefined();
    expect(exited!.dropped, `${ID} precondition: the app started no turn for the waiter's exit`).toBe(true);
    const stalled = await within(60_000, async () => after(await outcomes(hub, first.id), m1).find(is('stalled')));
    expect(stalled, `${ID} step 1: no turn showed your answer to ${first.handle}, so its delivery must read stalled within 60 s of the waiter's exit; outcomes: ${outcomeList(await outcomes(hub, first.id))}`).toBeDefined();
    const notWoken = await within(10_000, async () => after(await allEvents(hub), m1)
      .find((e) => about(e, s.id) && !HOOK_KINDS.has(e.kind) && e.kind !== 'delivery.outcome' && saysNotWoken(JSON.stringify(e.data))));
    expect(notWoken, `${ID} step 1: the record must say, on session ${s.id}, that it wasn't woken and that your answer goes with its next prompt; recorded since your answer: ${JSON.stringify(after(await allEvents(hub), m1).filter((e) => !HOOK_KINDS.has(e.kind)).map((e) => ({ kind: e.kind, session: e.session, data: e.data }))).slice(0, 3000)}`).toBeDefined();
    expect((await outcomes(hub, first.id)).filter(is('delivered')), `${ID} step 1: the waiter's exit alone never makes ${first.handle} delivered; no turn showed it`).toEqual([]);

    // ---- Step 2: your next prompt carries it; the turn shows it; then it reads delivered, once.
    const m2 = await mark(hub);
    const next = await prompt(app, s, 'Did my answer reach you?');
    expect(carriesAnswer(replied(next), first), `${ID} step 2: your answer to ${first.handle} (${first.green.label}) must come with the session's next prompt; DeepBuild replied: ${firedShown(next)}`).toBe(true);
    expect(contextEntries(s).some((c) => carriesAnswer(c, first)), `${ID} precondition: Claude Code wrote the prompt's added context, carrying ${first.handle}, into the transcript`).toBe(true);
    const stop2 = await endTurn(app, s, `Got it: ${first.green.label}.`);
    expect(carriesAnswer(stop2.blocked ?? '', first), `${ID} step 2: the prompt carried ${first.handle}; the turn's stop isn't sent back with it again: ${firedShown(stop2)}`).toBe(false);
    const delivered = await within(30_000, async () => after(await outcomes(hub, first.id), m2).find(is('delivered')));
    expect(delivered, `${ID} step 2: ${first.handle} must read delivered within 30 s of the turn that showed it; outcomes: ${outcomeList(await outcomes(hub, first.id))}`).toBeDefined();

    // ---- Step 3: you type again; the agent asks again and the session goes idle with a live waiter; you answer.
    const again = await prompt(app, s, 'Now pick one for the footer too, then stop.');
    expect(carriesAnswer(replied(again), first), `${ID} step 2: ${first.handle} was delivered; it must not come with a later prompt again: ${firedShown(again)}`).toBe(false);
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
    const later = await prompt(app, s, 'And my second answer?');
    expect(carriesAnswer(replied(later), second), `${ID} step 3: your answer to ${second.handle} (${second.green.label}) must come with the session's next prompt; DeepBuild replied: ${firedShown(later)}`).toBe(true);
    expect(carriesAnswer(replied(later), first), `${ID} step 2: ${first.handle} was delivered before; it must not come again: ${firedShown(later)}`).toBe(false);
    await endTurn(app, s, `Footer: ${second.green.label}.`);
    const deliveredSecond = await within(30_000, async () => after(await outcomes(hub, second.id), m4).find(is('delivered')));
    expect(deliveredSecond, `${ID} step 3: ${second.handle} must read delivered within 30 s of the turn that showed it; outcomes: ${outcomeList(await outcomes(hub, second.id))}`).toBeDefined();

    // Once each: nothing more is recorded for either after a few seconds, and the second never went by the waiter.
    await sleep(3000);
    expect((await outcomes(hub, first.id)).filter(is('delivered')), `${ID} step 2: ${first.handle} reads delivered once: ${outcomeList(await outcomes(hub, first.id))}`).toHaveLength(1);
    expect((await outcomes(hub, second.id)).filter(is('delivered')), `${ID} step 3: ${second.handle} reads delivered once: ${outcomeList(await outcomes(hub, second.id))}`).toHaveLength(1);
    expect(app.wakes.filter((w) => w.session === s.id && w.at >= t3 && names(w.stderr, second)), `${ID} step 3: no waiter exited 2 with your answer to ${second.handle} at any time`).toEqual([]);
    expect((await outcomes(hub, second.id)).filter(is('stalled')), `${ID} step 3: ${second.handle} never reads stalled`).toEqual([]);
  }, 900_000);
});

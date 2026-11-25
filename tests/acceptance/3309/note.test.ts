// #3309.c730ec7c: a note you sent from the app, carried in a UserPromptSubmit reply that deep-hook let through without
// reading it, goes with that session's next prompt that reaches the model, exactly once.
//
// A Claude Code session in a repo: you type a prompt and, while its turn runs, send the session a note from the app
// (`session.note`, #340). No stop has started a waiter, so the note waits for the session's next prompt. You type that
// prompt with #906's planted late reply in place: the hub's reply to it, which takes the note as its context, reaches
// deep-hook only after its hold ran out, so the prompt goes to the model without it. Then you type once more, as usual.
// Over the whole run's hook log the note must reach the agent exactly once, with that last prompt.
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, begin, cleanup, firedShown, makeHome, newSession, readLines, sleep, waitFor } from '../83/helpers.ts';
import { firedCarries, lateHub, lostPrompt, modelPrompts, reached, reachedShown, typed } from '../3305/helpers.ts';
import { NOTE, noteFromApp, tag } from './helpers.ts';

afterAll(cleanup, 60_000);

const FIRST = 'Fix the cart total, then stop.';
const LOST = 'Now add a test for total.ts.';
const NEXT = 'Then run the tests for total.ts.';

describe(`${NOTE} A note from the app carried in a prompt reply deep-hook never read goes with the session's next prompt that reaches the model, once`, () => {
  it(`${NOTE} a note sent from the app while a turn runs goes into "${LOST}"'s reply, which misses deep-hook's hold (the planted late reply); it reaches the agent exactly once, with "${NEXT}"`, async () => {
    const h = makeHome();
    const hub = await lateHub(h);
    const s = newSession(h, { remote: 'https://github.com/acme/widgets.git' });
    const claude = await begin(h, s, FIRST);
    const words = `Keep the 1.07 rate for Lisbon orders, note ${tag()}.`;
    const request = `r${tag(8)}`;
    await noteFromApp(hub, s.id, words, request);
    const recorded = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'session.note' && e.data?.request === request), 30_000, `the record's session.note for request ${request}`);
    expect(recorded.data.session, `the run's precondition: the note is recorded for session ${s.id}: ${JSON.stringify(recorded)}`).toBe(s.id);
    const anywhere = () => readLines(h.hookLog).filter((l) => l.session === s.id && l.phase === 'reply' && `${JSON.stringify(l.reply ?? null)}${String(l.stderr ?? '')}`.includes(words));
    expect(anywhere().map((l) => l.event), `the run's precondition: no hook carried the note ("${words}") before the late prompt, so it waits for the session's next prompt`).toEqual([]);

    const lost = await lostPrompt(h, claude, s, LOST);
    expect(firedCarries(lost, words), `the run's precondition: with the planted late reply in place deep-hook printed nothing for "${LOST}", so the prompt went without the note: ${firedShown(lost)}`).toBe(false);
    expect(lost.model, `the run's precondition: "${LOST}" still reaches the model: ${firedShown(lost)}`).toBe(true);
    // Past the hub's late write (1 s after the 2 s hold): that reply reached no one.
    await sleep(2000);

    const next = await typed(claude, s, NEXT);
    expect(next.model, `"${NEXT}" reaches the model: ${firedShown(next)}`).toBe(true);
    const r = reached(h, s, words);
    const asks = (await allEvents(hub)).filter((e) => e.kind === 'user.ask' && e.data?.request === request).map((e) => ({ id: e.id, log_pos: e.log_pos, text: String(e.data?.text ?? '').slice(0, 120) }));
    expect(r.length, `the note from the app ("${words}", request ${request}, session.note ${recorded.id}), carried in "${LOST}"'s reply that deep-hook never read, must reach the agent exactly once over the run (not zero, not twice); hook replies carrying it: ${reachedShown(r)}; the record's user.ask for it: ${JSON.stringify(asks)}; prompts that reached the model: ${JSON.stringify(modelPrompts(h, s))}; "${NEXT}"'s reply: ${firedShown(next)}`).toBe(1);
    expect(r[0]!.prompt, `the note goes with the session's next prompt that reaches the model, "${NEXT}": ${reachedShown(r)}`).toBe(NEXT);
    await claude.end();
  }, 240_000);
});

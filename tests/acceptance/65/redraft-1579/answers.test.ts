// Blind redraft (README) of #65's answers through channels, signed in the current format: AC1 (an answer on one
// channel closes the item everywhere and in Needs you within 10 s), AC3's stand-in-phone case (the phone's signed yes
// reaches the waiting session as a decision) and AC10 (B on the phone, then C in the app: B stands, C is refused naming
// B and its channel). Each is the earlier ../answers.test.ts case with the phone's and the app's signature in the
// design's shape; the world, the waits and the expected values are the earlier suite's.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, MINUTE, cleanup, closed, describeItem, inTime, inboxRow, live, ofKind, paseoAgent, permission, said, sleep, turnStarts, waitFor, world, type Line,
} from '../helpers.ts';
import { appAnswer, phoneOf } from './helpers.ts';

afterEach(cleanup, 120_000);
const CHOICE = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' } as const;

describe(`${AC[1]} An ask answered on one channel is gone from every other channel and from Needs you within 10 seconds`, () => {
  it(`${AC[1]} a choice answered on the paired phone is closed on chat, email and text, and in Needs you, within 10 s`, async (ctx) => {
    const w = await world({ channels: ['paseo', 'chat', 'email', 'text'], link: true, phone: true, seed: [CHOICE] });
    const [ask] = w.asks as [string];
    const p = w.providers;
    const phone = await phoneOf(w);
    for (const k of ['paseo', 'chat', 'email', 'text'] as const) await waitFor(() => p[k]!.latest(ask), MINUTE, `${ask} on the ${k} channel`);
    const since = Date.now();
    phone.answer(p.paseo!, ask, 'sqlite');
    const still = async (): Promise<string[]> => [
      ...(['chat', 'email', 'text'] as const).filter((k) => !closed(p[k]!.latest(ask))).map((k) => `${k} still shows ${describeItem(p[k]!.latest(ask))}`),
      ...((await inboxRow(w, ask))?.status === 'closed' ? [] : [`Needs you still holds it: ${JSON.stringify(await inboxRow(w, ask))}`]),
      ...(await ofKind(w, 'channel.refused', ask)).map((e) => `the hub refused the phone's answer: ${said([e])}`),
    ];
    await inTime(ctx, `${ask}, answered on the phone, gone from chat, email, text and Needs you`, since, 10_000, async () => (await still()).length === 0, async () => (await still()).join('; '));
    expect((await ofKind(w, 'ask.answered', ask)).map((e) => e.data.answer), 'the phone\'s answer is the one recorded').toEqual(['sqlite']);
  });
});

describe(`${AC[3]} An answer given in paseo's phone app, signed with the phone's paired device key, reaches the waiting session and is saved as a decision; the same answer with no valid signature counts as nothing for an authority ask and points to the trusted path`, () => {
  it(`${AC[3]} the phone's signed approve of a held permission request reaches the session as allow and is saved as a decision`, async () => {
    const w = await world({ channels: ['paseo'], phone: true });
    const phone = await phoneOf(w);
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const { ask, held } = await permission(w, a, 'git push origin main');
    const relay = w.providers.paseo!;
    const card = await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    expect(live(card), `the phone can answer the authority ask: ${describeItem(card)}`).toBe(true);
    phone.answer(relay, ask, 'approve');
    const reply = await Promise.race([held.reply, sleep(MINUTE).then(() => undefined)]);
    expect(reply, `the waiting session got an answer; the hub's refusals: ${said(await ofKind(w, 'channel.refused', ask))}`).toBeDefined();
    expect((JSON.parse(String(reply!.stdout)) as Line).decision, `the session's reply: ${JSON.stringify(reply)}`).toBe('allow');
    const decisions = (await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask);
    expect(decisions.map((e) => e.data.answer), `the phone's answer saved as a decision: ${said(decisions)}`).toEqual(['approve']);
  });
});

describe(`${AC[10]} One choice ask answered B on the paired phone and C in the app 2 s later records B, the first appended, refuses C naming B and its channel, and delivers one answer; a last-writer-wins hub delivers C after B and fails this test, naming both channels`, () => {
  it(`${AC[10]} B on the phone, then C in the app 2 s later: B is the one answer, and C is refused naming B and the paseo channel`, async () => {
    const options = [{ id: 'A', label: 'Retry once' }, { id: 'B', label: 'Retry three times' }, { id: 'C', label: 'Never retry' }];
    const control = { source: 'deep_ask.choice', question: 'Retry the download too?', options } as const;
    const w = await world({ channels: ['paseo'], phone: true, app: true, seed: [{ source: 'deep_ask.choice', question: 'How often should the upload retry?', options }, control] });
    const [ask, other] = w.asks as [string, string];
    const phone = await phoneOf(w);
    // The app's signature counts on an open ask, so a refused C below is refused for B, not for its signature, and a
    // last-writer-wins hub would take it.
    const first = await appAnswer(w, other, 'A');
    expect(first.error, `the app's signed answer counts on an open ask: ${JSON.stringify(first)}`).toBeUndefined();
    const relay = w.providers.paseo!;
    await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    const t0 = Date.now();
    const b = phone.answer(relay, ask, 'B');
    await waitFor(() => b.picked(), 30_000, 'the paseo channel taking B from the relay');
    await sleep(Math.max(0, t0 + 2000 - Date.now()));
    const c = await appAnswer(w, ask, 'C');
    await sleep(5000);
    const answered = await ofKind(w, 'ask.answered', ask);
    const recorded = answered.map((e) => String(e.data.answer));
    expect(recorded, `one answer, B from the phone (paseo); recorded: ${recorded.join(' then ') || 'none'}, so a hub that took the app's C after the phone's B fails here; the hub's refusals: ${said(await ofKind(w, 'channel.refused', ask))}`).toEqual(['B']);
    expect(c.error, `the app's C is refused: ${JSON.stringify(c)}`).toBeDefined();
    const why = JSON.stringify(c.error);
    expect(why, 'the refusal names B').toMatch(/\bB\b/);
    expect(why, 'the refusal names the channel B came by').toMatch(/paseo/);
  });
});

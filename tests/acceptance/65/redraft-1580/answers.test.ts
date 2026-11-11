// Blind redraft (README) of #65's AC3 signed case, the stand-in phone signing as #1580 says: a card with a plan
// carries the plan's hash, and the phone's signed fields include it. The world, the steps, the ids and the expected
// values are ../redraft-1579/answers.test.ts's AC3 case; only the phone (fixtures/phone.ts) is new.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, MINUTE, cleanup, describeItem, live, ofKind, paseoAgent, permission, said, sleep, turnStarts, waitFor, world, type Line } from '../helpers.ts';
import { hubOf } from '../redraft-1579/helpers.ts';
import { Phone, planHashOn } from './fixtures/phone.ts';

afterEach(cleanup, 120_000);

describe(`${AC[3]} An answer given in paseo's phone app, signed with the phone's paired device key, reaches the waiting session and is saved as a decision; the same answer with no valid signature counts as nothing for an authority ask and points to the trusted path`, () => {
  it(`${AC[3]} the phone's signed approve of a held permission request reaches the session as allow and is saved as a decision`, async () => {
    const w = await world({ channels: ['paseo'], phone: true });
    const phone = Phone.of(w.phone, await hubOf(w));
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const { ask, held } = await permission(w, a, 'git push origin main');
    const relay = w.providers.paseo!;
    const card = await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    expect(live(card), `the phone can answer the authority ask: ${describeItem(card)}`).toBe(true);
    phone.answer(relay, ask, 'approve');
    const reply = await Promise.race([held.reply, sleep(MINUTE).then(() => undefined)]);
    expect(reply, `the waiting session got an answer (the phone signed plan_hash ${planHashOn(card) ?? 'none, its card carrying no plan'}); the hub's refusals: ${said(await ofKind(w, 'channel.refused', ask))}`).toBeDefined();
    expect((JSON.parse(String(reply!.stdout)) as Line).decision, `the session's reply: ${JSON.stringify(reply)}`).toBe('allow');
    const decisions = (await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask);
    expect(decisions.map((e) => e.data.answer), `the phone's answer saved as a decision: ${said(decisions)}`).toEqual(['approve']);
  });
});

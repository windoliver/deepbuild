// #1579 AC3: an app answer signed in the new format counts, and the card's flow is otherwise unchanged. The twin of
// each app answer is the same answer from `deep inbox answer`'s path (a CLI connection, the OS stand-in confirming
// you), which #1579 doesn't change: both must be recorded and handed on alike (#34's AC4 reading), and both cards end
// alike. A signature in the new format that doesn't cover the answer sent counts for nothing, so a hub that took any
// signature-shaped object fails here too.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, answeredNothing, approve, asApp, cleanup, eventsOf, newDevice, refusedNaming, refusedSignature, result, signing, signNew, world, type Line, type Seeded, type World,
  holds,
} from './helpers.ts';
import { countedAnswer } from './scenarios.ts';

afterEach(cleanup, 60_000);

/** What the record hands the agent's adapter for an answer: everything ask.answered says but where it came from. */
const delivered = (data: Line) => ({ answer: data.answer, decision: data.decision, plan_hash: data.plan_hash, verified: data.verified, clicked: typeof data.token === 'string' });
/** The question card, as ask.card serves it, with what differs between two twin asks taken out. */
async function card(w: World, ask: Seeded): Promise<Line> {
  const c = result(await w.app.call('ask.card', { ask: ask.handle }, 30_000));
  const json = JSON.stringify(c).split(ask.handle).join('<ask>').split(ask.question).join('<question>');
  const out = JSON.parse(json) as Line;
  for (const k of ['ask', 'handle', 'id', 'key', 'pinned_to', 'created', 'deadline', 'age', 'since', 'due', 'plan', 'changed']) delete out[k];
  return out;
}
async function answeredData(w: World, ask: Seeded): Promise<Line> {
  const [e] = await eventsOf(w, 'ask.answered', ask.handle);
  return e!.data as Line;
}

describe(`${AC[3]} An app answer signed in the new format counts, and the card's flow is otherwise unchanged`, () => {
  it(`${AC[3]} an approval and a taste answer from the app, signed in the new format, count and are recorded, handed on and carded as their twins from the CLI are`, async () => {
    const w = await world({ asks: [
      { source: 'effect.push', question: 'Push feature/1579-app to origin?' },
      { source: 'effect.push', question: 'Push feature/1579-cli to origin?' },
      { source: 'deep_ask.taste', question: 'Which header colour on the 1579 login page?' },
      { source: 'deep_ask.taste', question: 'Which header colour on the 1579 signup page?' },
    ] });
    const [pushApp, pushCli, tasteApp, tasteCli] = w.asks as [Seeded, Seeded, Seeded, Seeded];
    // Before any answer, the twins' cards are alike.
    expect(await card(w, pushApp)).toEqual(await card(w, pushCli));
    expect(await card(w, tasteApp)).toEqual(await card(w, tasteCli));

    holds(await countedAnswer(w, pushApp, await asApp(w, 'ask.answer', signNew('ask.answer', approve(pushApp), w.device, await signing(w))), 'the app\'s approval in the new format'));
    const option = tasteApp.options[0]!.id;
    holds(await countedAnswer(w, tasteApp, await asApp(w, 'ask.answer', signNew('ask.answer', { ask: tasteApp.handle, option }, w.device, await signing(w))), 'the app\'s taste answer in the new format'));

    w.confirm.say(true);
    holds(await countedAnswer(w, pushCli, await w.cli.call('ask.answer', approve(pushCli), 30_000), 'the CLI twin\'s approval'));
    holds(await countedAnswer(w, tasteCli, await w.cli.call('ask.answer', { ask: tasteCli.handle, option }, 30_000), 'the CLI twin\'s taste answer'));
    w.confirm.say(false);

    const [a, b] = [await answeredData(w, pushApp), await answeredData(w, pushCli)];
    expect(delivered(a), 'the approval from the app is recorded and handed on as its CLI twin\'s').toEqual(delivered(b));
    expect(a.decision).toBe('allow');
    expect(delivered(await answeredData(w, tasteApp)), 'the taste answer from the app is recorded as its CLI twin\'s').toEqual(delivered(await answeredData(w, tasteCli)));
    // After the answers, the cards are alike too.
    expect(await card(w, pushApp)).toEqual(await card(w, pushCli));
    expect(await card(w, tasteApp)).toEqual(await card(w, tasteCli));
  }, 300_000);

  it(`${AC[3]} a new-format signature over other params than the answer sent is refused naming params; one by a key never paired, and an unsigned app answer, are refused; none answers`, async () => {
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push feature/1579-swap to origin?' }] });
    const ask = w.asks[0]!;
    const deny = ask.options.find((o) => o.decision === 'deny')!;
    // Signed as a no, sent as a yes.
    const signedNo = signNew('ask.answer', { ask: ask.handle, option: deny.id }, w.device, await signing(w));
    const swapped = { ...approve(ask), signature: signedNo.signature };
    holds(refusedNaming(await asApp(w, 'ask.answer', swapped), 'params', `${ask.handle}'s no, sent as a yes`));
    holds(await answeredNothing(w, ask.handle));
    // A stranger's key, signing as the paired app's ID.
    const stranger = { ...newDevice('never paired'), id: w.device.id! };
    holds(refusedSignature(await asApp(w, 'ask.answer', signNew('ask.answer', approve(ask), stranger, await signing(w))), 'an approval signed by a key never paired'));
    holds(await answeredNothing(w, ask.handle));
    // No signature, the OS ready to confirm: the app's answer still needs its device.
    w.confirm.say(true);
    expect('error' in (await asApp(w, 'ask.answer', approve(ask))), 'an unsigned app answer is refused').toBe(true);
    w.confirm.say(false);
    holds(await answeredNothing(w, ask.handle));
    // The paired app's own approval, signed for what it sends, then counts.
    holds(await countedAnswer(w, ask, await asApp(w, 'ask.answer', signNew('ask.answer', approve(ask), w.device, await signing(w))), 'the paired app\'s approval'));
  }, 300_000);
});

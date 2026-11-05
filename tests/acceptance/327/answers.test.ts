// The answers that reach the agent, the half of four criteria that lives past the card (README: The surfaces):
//
//   AC2  #327.da06e3b1  the option the card sends (C) is recorded in ask.answered and the agent's next input holds
//                       C's ID and label, with delivery.outcome delivered: on a real hub, the answer signed by the
//                       app's paired key, the agent's next input the Stop hook the hub holds for it (the card's click
//                       mapping, and the planted card that sends B, are card.rs: ac2_…);
//   AC7  #327.b12554f8  an answer in your own words, or with a screenshot, reaches the agent and is saved with the
//                       decision;
//   AC15 #327.2459a9a6  words with no option keep decision: none, reach the agent once, and never answer a second
//                       open ask with the same key (the card's "Answers this ask only" is card.rs: ac15_…);
//   AC16 #327.f9d8bea9  a typed "yes" on a push's card records decision: none with the words and the push isn't
//                       run; only Allow, with the plan's hash and the click's token, authorizes it (the card's
//                       "Sends your words as the reason; this won't run" and the planted card are card.rs: ac16_…).
import { afterEach, describe, expect, it } from 'vitest';
import type { Asks } from '../../../packages/asks/src/index.ts';
import {
  AC15, AC16, AC2, AC7, asApp, cleanup, clickToken, commit, Confirmer, confirmEnv, data, eventsAbout, fromHere, hookReply, hookRequest, inWorld, installedRoot, makeHome,
  newDevice, newSession, pair, pushAsk, pushPlan, result, seedInSessions, sendHook, sha256, shown, signed, sleep, startHub, tasteAsk, type Obj, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

// ---- AC2, on the hub.

describe(`AC2 ${AC2} the option the card sends is recorded and reaches the agent's next input with its ID and label, delivered`, () => {
  // Retired with the owner's approval on #906's PR: it reads delivered with no turn showing the answer, which #906 makes
  // wrong; answers-redraft/ac2.test.ts is AC2's hub-side test (README).
  it.skip(`${AC2} the app's answer C to a taste call (options A, C, B in the record; B recommended) records option C in ask.answered, the held Stop continues with C's ID and label, and delivery.outcome says delivered`, async () => {
    const home = makeHome();
    const confirm = new Confirmer();
    const s = newSession(home, 'claude-code');
    const options = [{ id: 'a', label: 'A: amber header', decision: 'none' as const }, { id: 'c', label: 'C: cobalt header', decision: 'none' as const }, { id: 'b', label: 'B: bone header', decision: 'none' as const }];
    const ask = { ...tasteAsk('Which header colour on the checkout total?', 'checkout', 'total', commit('ac2'), Date.now(), options), recommended: 'b', default: 'b' };
    const [seeded] = await seedInSessions(installedRoot(home), [{ session: s.id, source: 'deep_ask.taste', ask }]);
    const hub = await startHub({ home, env: confirmEnv(confirm) });
    const app = await asApp(hub);
    const device = newDevice("this Mac's app");
    confirm.say(true);
    const paired = await pair(app, device);
    confirm.say(false);
    if (!device.id) throw Error(`BLOCKED: device.pair didn't pair the app's key with the OS confirming you: ${shown(paired)}`);

    // The agent stops with the ask open: the hub holds its Stop for your answer (the agent's next input).
    const stop = sendHook(hub.socket, fromHere(hookRequest(s, 'Stop', { last_assistant_message: 'I asked which header colour you want.' })), 60_000);
    await sleep(500);
    // The card's click on C, as the app sends it: the option's ID, never its drawn position.
    const reply = await app.call('ask.answer', signed({ ask: seeded!.handle, option: 'c', token: clickToken() }, device), 20_000);
    expect('result' in reply, `the answer counts: ${shown(reply)}`).toBe(true);
    const answered = await eventsAbout(app, seeded!.handle, 'ask.answered');
    expect(answered.map((e) => (e.data as Obj).answer), `ask.answered records option C for ${seeded!.handle}`).toEqual(['c']);

    const held = await stop;
    const out = hookReply(held.reply);
    expect(out?.decision, `the held Stop continues with the answer (decision: block): ${shown(held.reply ?? held)}`).toBe('block');
    const text = String(out?.reason ?? '');
    expect(text.includes('c') && text.includes('C: cobalt header'), `the agent's next input holds C's ID and label, not B's: ${shown(text)}`).toBe(true);
    expect(text.includes('B: bone header'), `the agent's next input doesn't carry B, the recommended option: ${shown(text)}`).toBe(false);
    const outcomes = (await eventsAbout(app, seeded!.handle, 'delivery.outcome')).map((e) => (e.data as Obj).outcome);
    expect(outcomes, `delivery.outcome for ${seeded!.handle} says delivered`).toContain('delivered');
    app.close();
  }, 180_000);
});

// ---- AC7, in the asks core.

describe(`AC7 ${AC7} an ask answered in your own words or with a screenshot reaches the agent, and the answer is saved with the decision`, () => {
  const words = 'go with the cobalt, and keep the total in view';
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDR-and-pixels-of-a-screenshot'), Buffer.from('IEND')]);
  const image = sha256(png);

  it(`${AC7} an option with your words as its reason: the agent gets the option and the words once, and ask.answered keeps the words beside the decision`, async () => {
    await inWorld(async (w) => {
      await w.start('S1', 'thread-1', 'shop');
      const ask = await w.raise('S1', 'deep_ask.taste', tasteAsk('Which header colour?', 'checkout', 'total', commit('seven'), w.clock.now()));
      await w.answer(ask, { option: 'green', words });
      const delivered = w.deliveries.filter((d) => d.ask === ask);
      expect(delivered.map((d) => [d.option, d.decision, d.words]), 'the agent gets the option with the words, once').toEqual([['green', 'none', words]]);
      const answered = data(await w.answered(ask, 'words with an option'));
      expect(answered.decision, 'the option decides').toBe('none');
      expect(answered.answer, 'the option is the answer').toBe('green');
      expect(answered.words, `the words are kept with the answer, beside its decision (ask.answered.data.words); got ${shown(answered)}`).toBe(words);
    });
  }, 60_000);

  it(`${AC7} a screenshot with the answer: the agent gets the image by its hash, and ask.answered keeps it beside the decision`, async () => {
    await inWorld(async (w) => {
      await w.start('S1', 'thread-1', 'shop');
      const ask = await w.raise('S1', 'deep_ask.taste', tasteAsk('Which header colour?', 'checkout', 'total', commit('seven-image'), w.clock.now()));
      await w.answer(ask, { option: 'blue', image });
      const delivered = w.deliveries.filter((d) => d.ask === ask);
      expect(delivered.map((d) => [d.option, d.image]), `the agent gets the option and the screenshot's hash, once (Delivery.image)`).toEqual([['blue', image]]);
      const answered = data(await w.answered(ask, 'an image with an option'));
      expect(answered.image, `the image is kept with the answer by its SHA-256, beside its decision (ask.answered.data.image); got ${shown(answered)}`).toBe(image);
      expect(answered.decision, 'the option decides').toBe('none');
    });
  }, 60_000);

  it(`${AC7} words alone, no option: the agent gets them once with decision none, and nothing is saved as a decision`, async () => {
    await inWorld(async (w) => {
      await w.start('S1', 'thread-1', 'shop');
      const ask = await w.raise('S1', 'deep_ask.taste', tasteAsk('Which header colour?', 'checkout', 'total', commit('seven-words'), w.clock.now()));
      await w.answer(ask, { words });
      expect(w.deliveries.filter((d) => d.ask === ask).map((d) => [d.option, d.decision, d.words]), 'the agent gets the words once').toEqual([[null, 'none', words]]);
      const answered = data(await w.answered(ask, 'words alone'));
      expect([answered.decision, answered.words ?? answered.answer], 'decision none, the words kept').toEqual(['none', words]);
      expect((await w.savedFrom(ask)).map((e) => data(e)), 'words are never saved as a decision').toEqual([]);
    });
  }, 60_000);
});

// ---- AC15, in the asks core.

const DARKER = 'darker, and keep the total in view';

async function wordsScenario(w: World): Promise<{ first: string; second: string; failures: string[] }> {
  const failures: string[] = [];
  await w.start('S1', 'thread-1', 'shop');
  await w.start('S2', 'thread-2', 'shop');
  const first = await w.raise('S1', 'deep_ask.taste', tasteAsk('Which header on the checkout total?', 'checkout', 'total', commit('fifteen-one'), w.clock.now()));
  w.clock.advance(1000);
  const second = await w.raise('S2', 'deep_ask.taste', tasteAsk('Header colour over the total?', 'checkout', 'total', commit('fifteen-two'), w.clock.now()));
  const keys = await Promise.all([first, second].map(async (ask) => String(data((await w.events('ask.created')).find((e) => e.id === ask.slice(4))!).key)));
  if (keys[0] !== keys[1]) throw Error(`BLOCKED: setup: the two taste calls on one screen and element should share a key; got ${shown(keys)}`);
  await w.answer(first, { words: DARKER });
  const answered = data(await w.answered(first, 'typing with no option'));
  if (answered.decision !== 'none') failures.push(`the answer's decision is ${shown(answered.decision)}, not none`);
  if ((answered.words ?? answered.answer) !== DARKER) failures.push(`the words aren't kept with the answer: ${shown(answered)}`);
  const delivered = w.deliveries.filter((d) => d.ask === first);
  if (delivered.length !== 1 || delivered[0]!.words !== DARKER || delivered[0]!.decision !== 'none' || delivered[0]!.option !== null) failures.push(`the agent gets the words once with decision none and no option; got ${shown(delivered)}`);
  if ((await w.savedFrom(first)).length) failures.push('the words were saved as a decision');
  // The second open ask with the same key stays open: the resolver never answers it from those words.
  const row = await w.row(second);
  const applied = await w.appliedTo(second);
  const answeredSecond = (await w.events('ask.answered')).filter((e) => e.subject === second);
  const handed = w.deliveries.filter((d) => d.ask === second);
  if (row.outcome !== 'unanswered' || applied.length || answeredSecond.length || handed.length || !(await w.shown()).includes(second)) {
    failures.push(`${second}, a second open ask with the same key, was answered from the first one's words: outcome ${row.outcome}, applied ${shown(applied.map(data))}, answered ${shown(answeredSecond.map(data))}, handed ${shown(handed)}`);
  }
  return { first, second, failures };
}

describe(`AC15 ${AC15} a taste card answered by typing, with no option chosen, keeps the words beside decision: none, reaches the agent once, and a second open ask with the same key stays open`, () => {
  it(`${AC15} typing "${DARKER}" and Send: decision none with the words, delivered once; the second ask with the same key stays open`, async () => {
    await inWorld(async (w) => {
      const { failures } = await wordsScenario(w);
      expect(failures, 'the words answer this ask only').toEqual([]);
    });
  }, 60_000);

  it(`${AC15} wrong program: a resolver that answers the second ask from the first one's words fails this test, naming the ask`, async () => {
    await inWorld(async (w) => {
      const { second, failures } = await wordsScenario(w);
      expect(failures.length, `the planted resolver is caught: ${shown(failures)}`).toBeGreaterThan(0);
      expect(failures.join('\n'), 'naming the second ask').toContain(second);
    }, {
      // Planted in the asks core the card and the resolver share: a words answer to one ask answers every other open
      // ask of its key with the same words.
      asks: (asks: Asks, w) => ({
        ...asks,
        answer: async (connection, ask, input) => {
          await asks.answer(connection, ask, input);
          const words = (input as { words?: string }).words;
          if (words === undefined) return;
          const key = String(data((await w.events('ask.created')).find((e) => e.id === ask.slice(4))!).key);
          for (const row of (await asks.inbox()).filter((r) => r.outcome === 'unanswered' && r.ask !== ask)) {
            const created = (await w.events('ask.created')).find((e) => e.id === row.ask.slice(4));
            if (created && String(data(created).key) === key) await asks.answer(connection, row.ask, { words });
          }
        },
      }),
    });
  }, 60_000);
});

// ---- AC16, in the asks core.

async function pushScenario(w: World, typed: Record<string, unknown>): Promise<{ ask: string; hash: string; failures: string[] }> {
  const failures: string[] = [];
  await w.start('S1', 'thread-1', 'shop');
  const plan = pushPlan('feat/cart');
  const ask = await w.raise('S1', 'effect.push', pushAsk('feat/cart', 'thread-1', w.clock.now()), plan);
  const shownCard = await w.card(ask);
  const hash = shownCard.plan?.hash ?? '';
  if (!hash) throw Error(`BLOCKED: setup: the push's card carries no plan: ${shown(shownCard)}`);
  await w.answer(ask, typed);
  const answered = data(await w.answered(ask, 'typing yes'));
  if (answered.decision !== 'none') failures.push(`the card read the typed "yes" as ${shown(answered.decision)}: ${ask}'s answer must be decision: none with the words`);
  if ((answered.words ?? answered.answer) !== 'yes') failures.push(`the words aren't recorded with the answer: ${shown(answered)}`);
  const authorized = await w.asks.authorized(ask, hash);
  if (authorized !== null) failures.push(`the push runs on a typed "yes": authorized(${ask}) answered ${shown(authorized)}`);
  const delivered = w.deliveries.filter((d) => d.ask === ask);
  if (delivered.length !== 1 || delivered[0]!.decision !== 'none' || delivered[0]!.option !== null || delivered[0]!.words !== 'yes') failures.push(`the agent is told the push is denied with your words as the reason (decision none, no option, words "yes"); got ${shown(delivered)}`);
  return { ask, hash, failures };
}

describe(`AC16 ${AC16} on a push's authority card a typed "yes" records decision: none with the words and the push is denied with them as its reason; only Allow runs the plan`, () => {
  it(`${AC16} typing "yes" and Send: decision none with the words, the plan not authorized, the agent told so with the words`, async () => {
    await inWorld(async (w) => {
      const { failures } = await pushScenario(w, { words: 'yes' });
      expect(failures, 'a typed yes never allows anything').toEqual([]);
    });
  }, 60_000);

  it(`${AC16} pressing Allow, with the plan's hash and the click's token, runs the plan: decision allow and the plan authorized`, async () => {
    await inWorld(async (w) => {
      await w.start('S1', 'thread-1', 'shop');
      const plan = pushPlan('feat/cart');
      const ask = await w.raise('S1', 'effect.push', pushAsk('feat/cart', 'thread-1', w.clock.now()), plan);
      const hash = (await w.card(ask)).plan?.hash ?? '';
      await w.answer(ask, { option: 'approve', plan_hash: hash, token: clickToken() });
      expect(data(await w.answered(ask, 'Allow')).decision, 'Allow decides allow').toBe('allow');
      expect(await w.asks.authorized(ask, hash), 'the plan is authorized').not.toBeNull();
      expect(w.deliveries.filter((d) => d.ask === ask).map((d) => [d.option, d.decision]), 'the agent gets the allow once').toEqual([['approve', 'allow']]);
    });
  }, 60_000);

  it(`${AC16} wrong program: a card that reads the typed "yes" as allow fails this test, naming the card`, async () => {
    await inWorld(async (w) => {
      const { ask, failures } = await pushScenario(w, { words: 'yes' });
      expect(failures.length, `the planted card is caught: ${shown(failures)}`).toBeGreaterThan(0);
      expect(failures.join('\n'), "naming the card's ask").toContain(ask);
    }, {
      // Planted at the card: a typed "yes" on an authority ask is sent as its allowing option.
      asks: (asks: Asks, w) => ({
        ...asks,
        answer: async (connection, ask, input) => {
          const typed = input as { words?: string };
          if (typed.words?.trim().toLowerCase() === 'yes') {
            const c = await w.card(ask);
            const allow = c.options.find((o) => o.decision === 'allow');
            if (allow) return asks.answer(connection, ask, { option: allow.id, plan_hash: c.plan?.hash ?? null, token: clickToken() });
          }
          return asks.answer(connection, ask, input);
        },
      }),
    });
  }, 60_000);
});

// Keeps `result` in the surface this file imports from the hub helpers; a reply that is an error throws naming it.
void result;

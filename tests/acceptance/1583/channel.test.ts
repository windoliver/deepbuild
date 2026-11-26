// #1583 on a channel's card and in `deep inbox` (README, Each criterion to its tests). One hub, its asks raised
// before it starts: a question holding a zero-width space, a right-to-left override and a tag character with three
// options holding one each, a question quoting a link whose target holds them, and plain questions in Chinese, in
// Arabic and with emoji. Each ask's card is read as the paseo relay first got it and `deep inbox` as the bytes it
// printed, both before any test runs, since the phone's answer closes its ask; the record is read last, through
// `events.read`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cardOf, cleanup, deepBytes, events, lastPos, MINUTE, outcomeOf, rowOf, said, signedAnswer, world, type Bytes, type Item, type World } from './helpers.ts';
import { drawn, sameBytes, sameCard, show } from './judge.ts';
import { HIDDEN_ASK, LINK, LINK_ASK, PLAIN_ASKS, type Raised } from './texts.ts';

const RAISED: readonly Raised[] = [HIDDEN_ASK, LINK_ASK, ...PLAIN_ASKS];
let w: World;
const cards: Record<string, Item> = {};
let inbox: Bytes;

beforeAll(async () => {
  w = await world(RAISED);
  for (const ask of Object.values(w.asks)) cards[ask.name] = await cardOf(w, ask);
  inbox = await deepBytes(w.home, ['inbox']);
  if (inbox.code !== 0) throw Error(`BLOCKED: setup: deep inbox exited ${inbox.code}: ${inbox.stderr.slice(-1500)}`);
}, 15 * MINUTE);
afterAll(cleanup, 2 * MINUTE);

/** The card the relay got for an ask of this file, and the ask as raised. */
const got = (name: string): { card: Item; ask: World['asks'][string] } => ({ card: cards[name]!, ask: w.asks[name]! });
/** What `deep inbox` printed for an ask: its row and the lines under it. */
function printed(name: string): string[] {
  const { row, under } = rowOf(inbox.stdout, w.asks[name]!.handle);
  if (row === undefined) throw Error(`BLOCKED: deep inbox lists no row for ${w.asks[name]!.handle} (the ${name} ask): ${show(inbox.stdout.toString('utf8'))}`);
  return [row, ...under];
}

describe('AC5 #1583.69ea36be A channel\'s summary carries the same escapes', () => {
  it('AC5 #1583.69ea36be the summary the paseo relay got for a question holding a zero-width space, a right-to-left override and a tag character shows each as its escape, and none raw', () => {
    const { card, ask } = got('hidden');
    expect(drawn(`the summary of ${ask.handle}'s card on the paseo channel`, ask.question, [card.summary]).map((f) => f.message)).toEqual([]);
  });

  it('AC5 #1583.69ea36be the card hash covers the text as shown: a phone\'s signature over the card with the stored text in place of the shown is refused, naming card_hash, and one over the card as the relay shows it counts', async () => {
    const ask = w.asks.hidden!;
    const option = ask.options[0]!.id;
    const shown = w.relay.latest(ask.handle)!;
    // The same card, its words as the record holds them: what a hash that doesn't cover the text as shown would cover.
    const stored: Item = { ...shown, summary: ask.question, options: ask.options.map(({ id, label }) => ({ id, label })) };
    const since = await lastPos(w);
    w.relay.give(signedAnswer(w, stored, option));
    const first = await outcomeOf(w, ask.handle, since, `the hub refusing or counting a signature over ${ask.handle}'s stored text`);
    expect(first.kind, `a signature over ${show(stored.summary)}, the text as stored, is refused, since the card shows ${show(shown.summary)}: ${said([first])}`).toBe('channel.refused');
    expect(first.data.field, `the refusal names the card's hash: ${said([first])}`).toBe('card_hash');
    expect((await events(w)).filter((e) => e.kind === 'ask.answered' && e.subject === ask.handle), 'the refused signature counted for nothing').toEqual([]);

    const now = w.relay.latest(ask.handle)!;
    const again = await lastPos(w);
    w.relay.give(signedAnswer(w, now, option));
    const counted = await outcomeOf(w, ask.handle, again, `the hub counting a signature over ${ask.handle}'s card as the relay shows it`);
    expect(counted.kind, `a signature over the card as shown, ${show(now.summary)}, counts: ${said([counted])}`).toBe('ask.answered');
  }, 5 * MINUTE);
});

describe('AC1 #1583.f0f56109 Each of a zero-width space, a right-to-left override and a tag character in an option draws as a visible escape. A planted card that draws them raw fails, naming the character', () => {
  it('AC1 #1583.f0f56109 on a channel\'s card, an option holding each of the three characters shows it as its escape, under the ID it was raised with', () => {
    const { card, ask } = got('hidden');
    expect(card.options.map((o) => o.id), `the card's options keep their IDs: ${JSON.stringify(card.options)}`).toEqual(ask.options.map((o) => o.id));
    const findings = ask.options.flatMap((o, i) => drawn(`the label of option ${o.id} on ${ask.handle}'s card on the paseo channel`, o.label, [card.options[i]!.label]));
    expect(findings.map((f) => f.message)).toEqual([]);
  });

  it('AC1 #1583.f0f56109 a link\'s target holding each of the three characters shows it as its escape in a channel\'s summary', () => {
    const { card, ask } = got('link');
    expect(drawn(`the link's target in the summary of ${ask.handle}'s card on the paseo channel`, LINK, [card.summary]).map((f) => f.message)).toEqual([]);
  });

  it('AC1 #1583.f0f56109 deep inbox prints an option, a question and a link\'s target holding each of the three characters with its escape, and none raw (the base does: it must stay so)', () => {
    const hidden = printed('hidden');
    const findings = [
      ...HIDDEN_ASK.options.flatMap((o) => drawn(`deep inbox's lines for ${w.asks.hidden!.handle}, option ${o.id}`, o.label, hidden)),
      ...drawn(`deep inbox's lines for ${w.asks.hidden!.handle}, its question`, HIDDEN_ASK.question, hidden),
      ...drawn(`deep inbox's lines for ${w.asks.link!.handle}, its link's target`, LINK, printed('link')),
    ];
    expect(findings.map((f) => f.message)).toEqual([]);
  });
});

describe('AC4 #1583.e10b90b9 Plain text in Chinese, Arabic and with emoji draws unchanged and adds no warning', () => {
  it('AC4 #1583.e10b90b9 a channel\'s card and deep inbox show a plain question and its options in Chinese, in Arabic and with emoji as they were raised (the base does: it must stay so)', () => {
    const problems: string[] = [];
    for (const plain of PLAIN_ASKS) {
      const { card, ask } = got(plain.name);
      problems.push(...sameCard(`the ${plain.name} ask's card on the paseo channel (${ask.handle})`, card, plain));
      const lines = printed(plain.name);
      for (const text of [plain.question, ...plain.options.map((o) => o.label)]) {
        if (!lines.some((line) => Buffer.from(line, 'utf8').includes(Buffer.from(text, 'utf8')))) problems.push(`deep inbox's lines for the ${plain.name} ask (${ask.handle}) don't hold ${show(text)} byte for byte: ${lines.map(show).join(' | ')}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('AC3 #1583.89af5457 The stored ask is byte-equal to what was raised', () => {
  it('AC3 #1583.89af5457 each ask\'s question and options, read back from the hub\'s record after its card went out, deep inbox printed it and the phone answered, are the bytes it was raised with (the base keeps them: it must stay so)', async () => {
    const all = await events(w);
    const problems: string[] = [];
    for (const ask of Object.values(w.asks)) {
      const created = all.find((e) => e.kind === 'ask.created' && (e.subject === ask.handle || `ask:${e.id}` === ask.handle));
      if (!created) {
        problems.push(`the record holds no ask.created for ${ask.handle} (the ${ask.name} ask)`);
        continue;
      }
      problems.push(...sameBytes(`${ask.handle}'s ask.created question`, created.data.question, ask.question));
      const options = Array.isArray(created.data.options) ? created.data.options as { id?: unknown; label?: unknown }[] : [];
      if (options.length !== ask.options.length) problems.push(`${ask.handle}'s ask.created holds ${options.length} options, not the ${ask.options.length} raised`);
      for (const [i, o] of ask.options.entries()) {
        problems.push(...sameBytes(`${ask.handle}'s ask.created option ${i + 1} ID`, options[i]?.id, o.id), ...sameBytes(`${ask.handle}'s ask.created option ${i + 1} label`, options[i]?.label, o.label));
      }
    }
    expect(problems).toEqual([]);
  }, 2 * MINUTE);
});

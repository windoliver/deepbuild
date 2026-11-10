// AC3, the card half, and AC4. In the replica, on its virtual clock, `open` on an ask's address presents that ask's card
// and nothing more: right after it the card's node (`question-card`, #1459) reads `presented`, never `armed` (its interval
// is 500 ms; an open takes a frame or two), and the ask's row is still in Needs you. The record half of AC3, that no event
// is written, needs the hub's record, so it is in cli.test.ts. AC4: an ask answered earlier, and an address nothing
// matches, each open a page that says something: what the ask was and what closed it, and "No match" with what was asked
// for (README, Pinned 5). Neither is a blank page.
import { describe, expect, it } from 'vitest';
import { askAt, CLOSED_ASK, driveBinary, flat, ID, MIN, OPEN_ASK, Replica, words, type SNode } from './helpers.ts';

const has = (all: readonly string[], text: string): boolean => all.some((w) => w.toLowerCase().includes(text.toLowerCase()));

describe(`AC3 ${ID.unarmed} \`open\` on an ask presents its card unarmed, and the record gains no answer. A planted \`open\` that writes an event fails, naming the event`, () => {
  it(`AC3 ${ID.unarmed} in the replica, open ${askAt(OPEN_ASK.handle)} lands on that address with the ask's card presented and unarmed, and its row still in Needs you`, async () => {
    const r = await Replica.on(await driveBinary());
    const failures: string[] = [];
    try {
      const address = askAt(OPEN_ASK.handle);
      await r.open(address);
      const window = await r.window();
      const nodes = flat(window.tree);
      const cards = nodes.filter((n) => n.id === 'question-card');
      if (cards.length !== 1) failures.push(`open ${address} presents ${cards.length} question cards, not one`);
      const card = cards[0];
      if (card && card.value !== 'presented') failures.push(`right after open the card reads ${JSON.stringify(card.value)}, not "presented": open must never arm it`);
      if (card && !has(words(card), OPEN_ASK.question)) failures.push(`the card open presented isn't ${OPEN_ASK.handle}'s: it never says "${OPEN_ASK.question}"`);
      if (!nodes.some((n) => n.id === address)) failures.push(`the window's page doesn't carry the address open was given, ${address} (README, Pinned 2)`);
      if (!nodes.some((n) => n.id === OPEN_ASK.handle)) failures.push(`after open, ${OPEN_ASK.handle}'s row is gone from Needs you: the ask no longer reads open`);
    } catch (error) {
      failures.push((error as Error).message);
    } finally {
      await r.stop();
    }
    expect(failures).toEqual([]);
  }, 20 * MIN);
});

describe(`AC4 ${ID.unresolved} An address for a closed ask shows what closed it, and a nonsense address says no match. Neither shows a blank page`, () => {
  it(`AC4 ${ID.unresolved} open ${askAt(CLOSED_ASK.handle)}, answered earlier from the card, shows the ask's question, that it was answered and the answer "${CLOSED_ASK.answer}"`, async () => {
    const r = await Replica.on(await driveBinary());
    const failures: string[] = [];
    try {
      const address = askAt(CLOSED_ASK.handle);
      await r.open(address);
      const pages = flat((await r.window()).tree).filter((n) => n.id === address);
      if (pages.length !== 1) failures.push(`open ${address} shows no page with that address: ${pages.length} nodes carry it (README, Pinned 2)`);
      else {
        // What the page region shows, a card over it included: see scoped to the page's node.
        const said = words(await r.page(address));
        if (!said.length) failures.push(`open ${address} shows a blank page: its node holds no words`);
        if (!has(said, CLOSED_ASK.question)) failures.push(`the page for the closed ask doesn't say what it was, "${CLOSED_ASK.question}": it holds ${JSON.stringify(said).slice(0, 400)}`);
        if (!has(said, 'answered')) failures.push(`the page for the closed ask doesn't say it was answered: it holds ${JSON.stringify(said).slice(0, 400)}`);
        if (!has(said, CLOSED_ASK.answer)) failures.push(`the page for the closed ask doesn't say what closed it, the answer "${CLOSED_ASK.answer}": it holds ${JSON.stringify(said).slice(0, 400)}`);
      }
    } catch (error) {
      failures.push((error as Error).message);
    } finally {
      await r.stop();
    }
    expect(failures).toEqual([]);
  }, 20 * MIN);

  it(`AC4 ${ID.unresolved} open nonsense/what-is-this, which names nothing, shows a page saying "No match" with the address, not a blank one`, async () => {
    const r = await Replica.on(await driveBinary());
    const failures: string[] = [];
    const address = 'nonsense/what-is-this';
    try {
      const reply = await r.drive.call({ call: 'open', open: { address } });
      if (reply.ok !== true && /is no call/.test(JSON.stringify(reply))) throw Error(`deep_drive has no open: ${JSON.stringify(reply.error).slice(0, 300)}`);
      const nodes: SNode[] = flat((await r.window()).tree);
      const noMatch = nodes.filter((n) => (n.name ?? '').startsWith('No match') && (n.name ?? '').includes(address));
      if (!noMatch.length) failures.push(`open ${address} shows no node named "No match …${address}…" (README, Pinned 5); the window says ${JSON.stringify(nodes.map((n) => n.name).filter(Boolean)).slice(0, 500)}`);
    } catch (error) {
      failures.push((error as Error).message);
    } finally {
      await r.stop();
    }
    expect(failures).toEqual([]);
  }, 20 * MIN);
});

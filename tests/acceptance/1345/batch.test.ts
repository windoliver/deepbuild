// AC3, AC7 and AC8 share one world, the Proof's fixture run: five issues under a standing rule, each change reversible
// and landed with its taste call open, so five calls from five issues wait for you across a day; your visits come once
// a day, and the hub's clock is stepped to the next one. Then the record's showing of the calls, and the app drawn over
// a copy of the record on the first call's page: the plain one, and each planted card. AC7 then presses the first
// row's Send back, through your answer on the trusted path, to see that it does what the row said.
import { expect, test } from 'vitest';
import {
  cardFailures, draw, FIRST, flat, lists, MIN, named, openCallsOf, PLANT, said, sendBackOf, timeFailures, waitUntil, World,
  type Call, type Drawn, type SNode,
} from './helpers.ts';

const ISSUES = [100, 101, 102, 103, 104];

interface Five { w: World; calls: Call[]; plain: Drawn; unannounced: Drawn; timeless: Drawn }
let five: Promise<Five> | undefined;
/** The world, once: built by whichever test comes first, and read by the others. */
const fiveCalls = (): Promise<Five> => (five ??= (async () => {
  const w = await World.open({ issues: ISSUES.map(() => ({})), atOnce: 'five', visits: true, clock: true });
  await w.startRun();
  const first = await waitUntil(() => ISSUES.find((n) => w.merged(n)), FIRST, 2000);
  expect(first, `a reversible change with its taste call open lands within ${FIRST / MIN} minutes of the approval (${(await Promise.all(ISSUES.map((n) => w.about(n)))).join(' | ')})`).toBeDefined();
  const all = await waitUntil(async () => { const events = await w.events(); return ISSUES.every((n) => w.merged(n) && openCallsOf(events, n).length > 0); }, 45 * MIN, 5000);
  const now = await w.events();
  expect(all, `each of the five changes lands with its taste call open: ${ISSUES.map((n) => `#${n} ${w.merged(n) ? 'landed' : 'not landed'}, ${openCallsOf(now, n).length} open calls`).join('; ')}`).toBe(true);
  const calls = ISSUES.map((n) => openCallsOf(now, n)[0]!);
  // Your next visit, a day's calls in hand.
  await w.toNextVisit();
  const shown = await waitUntil(async () => { const events = await w.events(); return calls.every((c) => events.some((e) => lists(e, c.handle))); }, 5 * MIN, 2000);
  expect(shown, `your next visit shows the five calls (${calls.map((c) => c.handle).join(', ')})`).toBe(true);
  const open = `ask/${calls[0]!.id}`;
  return {
    w, calls,
    plain: await draw(w, { open }),
    unannounced: await draw(w, { open, plant: PLANT.rowRevertsUnannounced }),
    timeless: await draw(w, { open, plant: PLANT.rowWithoutTime }),
  };
})());
/** The card's rows in the order the tree holds them, each as its call. */
const rowOrder = (tree: SNode, calls: readonly Call[]): Call[] => flat(tree).flatMap((x) => calls.filter((c) => x.id === `card-row:${c.id}`));
/** What a row's Send back does here: it reverts a change that landed, and starts an attempt on one that didn't (README: readings). */
const sendBack = (w: World) => (c: Call): 'reverts' | 'attempts' => (w.merged(c.issue) ? 'reverts' : 'attempts');

test(named(3), async () => {
  const { w, calls, plain } = await fiveCalls();
  const batches = (await w.events()).filter((e) => calls.some((c) => lists(e, c.handle)));
  expect(batches.map(said), 'the five calls reach you as one card: one showing holds them').toHaveLength(1);
  expect(calls.filter((c) => !lists(batches[0]!, c.handle)).map((c) => c.handle), 'that one showing holds all five calls').toEqual([]);
  expect(plain.notifications.map((n) => `${n.ask ?? 'no ask'}: ${n.text.slice(0, 200)}`), 'that day raises one notification (the app\'s model of Notification Center)').toHaveLength(1);
}, 150 * MIN);

test(named(7), async () => {
  const { w, calls, plain, unannounced } = await fiveCalls();
  expect(cardFailures(plain.seen, calls, sendBack(w)), "the five calls draw as #328's batched taste card, one card of five rows, each saying what its Send back does").toEqual([]);

  // The planted card's first row whose Send back reverts doesn't say so: the same judgement fails, naming its issue.
  const planted = cardFailures(unannounced.seen, calls, sendBack(w));
  expect(planted.length, 'the planted row that reverts unannounced fails the judgement; a pass proves nothing').toBeGreaterThan(0);
  const quiet = rowOrder(unannounced.seen.tree, calls).find((c) => sendBack(w)(c) === 'reverts');
  expect(quiet, 'the planted card draws a row whose Send back reverts').toBeDefined();
  expect(planted.join('\n'), 'its failure names the issue').toContain(`#${quiet!.issue}`);

  // Pressed, the first row's Send back does what the row said before it: the change it landed is reverted on main.
  const row = rowOrder(plain.seen.tree, calls)[0]!;
  expect(sendBack(w)(row), `#${row.issue}'s row, the card's first, is a landed change's: its Send back reverts it`).toBe('reverts');
  const no = sendBackOf(row);
  expect(no, `${row.handle} offers Send back: ${JSON.stringify(row.data.options)}`).toBeDefined();
  const refused = await w.answer(row.handle, no!, 'Keep the look it had.').then(() => null, (error: Error) => error.message);
  expect(refused, `your Send back on ${row.handle} counts on the trusted path`).toBeNull();
  const reverted = await waitUntil(async () => (await w.main(`src/i${row.issue}.txt`)) === `open ${row.issue}\n`, 20 * MIN, 5000);
  expect(reverted, `#${row.issue}'s row said its Send back reverts this change, and pressed, it does: main's src/i${row.issue}.txt reads as before the change (${JSON.stringify(await w.main(`src/i${row.issue}.txt`))})`).toBe(true);
}, 150 * MIN);

test(named(8), async () => {
  const { calls, plain, timeless } = await fiveCalls();
  expect(timeFailures(plain.seen, calls), 'each of the five rows shows when its recommended answer applies, and the rows add up to the count').toEqual([]);

  // The planted card draws no time on its first row: the same judgement fails, naming the row.
  const planted = timeFailures(timeless.seen, calls);
  expect(planted.length, 'the planted card with no time on a row fails the judgement; a pass proves nothing').toBeGreaterThan(0);
  const first = rowOrder(timeless.seen.tree, calls)[0];
  expect(first, 'the planted card draws its rows').toBeDefined();
  expect(planted.join('\n'), 'its failure names the row').toContain(`card-row:${first!.id}`);
}, 150 * MIN);

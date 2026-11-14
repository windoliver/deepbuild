// #1802.9ef4dcb1: "An extension is one ask answered by a person, recorded with its reason and a new `decide_by` at most
// 2 releases later. A second extension of the same entry is refused, and an agent's patch to `decide_by` is refused"
//
// asserts: deep.trial is a preview since R1 whose `decide_by` is R3, in the fixture releases R1 and R2. The hub's
// `extendPreview` (README: the hub's public entry), asked to move it to R5, 2 releases later, with a reason, raises
// exactly one ask on the asks core it was given, whose card names deep.trial; while that ask is open the call waits and
// the tree is as it was. Your yes on the trusted path settles the call, and the tree then records the extension: one
// row in contracts/extensions.json for api:deep.trial, from R3 to R5, with the reason and the ask's handle, and
// deep.trial's published `decide_by` is R5; the preflight then passes R3. A request for R6, 3 releases later, is
// refused naming deep.trial, raising no ask and recording nothing. After one extension (R3 to R4), a second for the
// same entry (R4 to R5) is refused naming deep.trial, raising no ask and recording nothing. And a `decide_by` patched
// in the published data with no extension on record (R3 to R4 in the candidate R2, inside the cap of 3) fails the
// preflight, naming deep.trial.
// Wrong program: the merge base, whose hub exports no `extendPreview` and whose step reads no `decide_by`.

import { expect, it } from 'vitest';
import {
  TRIAL, addApi, answerCard, cardsNaming, check, decideByOf, editApi, emptyTree, expectFailNaming, expectPass, extensionsOf, hubEntry, openWorld, previewEntry,
  record, sleep, trialTree, waitUntil, type ExtendPreview, type Tree, type World,
} from './helpers.ts';

const REASON = 'Its replacement, deep.steady, lands in R5.';

/** The hub's `extendPreview`, reached through the package's public entry. */
async function extender(): Promise<ExtendPreview> {
  const { extendPreview } = await hubEntry();
  expect(typeof extendPreview, 'the hub\'s public entry exports extendPreview').toBe('function');
  return extendPreview!;
}
/** One request to extend deep.trial in the tree: 'extended' once it is on record, or 'refused: ' and the reason. */
const request = (extend: ExtendPreview, w: World, t: Tree, decideBy: string): Promise<string> =>
  Promise.resolve()
    .then(() => extend({ root: t.root, record: w.record, asks: w.asks, entry: `api:${TRIAL}`, decide_by: decideBy, reason: REASON }))
    .then(() => 'extended', (e: unknown) => `refused: ${String((e as Error)?.message ?? e)}`);
/** A request that must be refused at once: its outcome, or that it was still waiting after 10 s. */
const refusal = (extend: ExtendPreview, w: World, t: Tree, decideBy: string): Promise<string> =>
  Promise.race([request(extend, w, t, decideBy), sleep(10_000).then(() => 'still waiting after 10 s')]);
const asksRaised = async (w: World): Promise<number> => (await w.asks.inbox()).length;
const openCard = (w: World): Promise<{ ask: string }[]> =>
  waitUntil(async () => { const cards = await cardsNaming(w, TRIAL); return cards.length ? cards : undefined; }, 30_000, `an ask whose card names ${TRIAL}`);

it('#1802.9ef4dcb1 an extension is one ask, recorded only by your answer, with its reason and a new decide_by 2 releases later', async () => {
  const extend = await extender();
  const w = await openWorld();
  const t = trialTree();
  const settled = request(extend, w, t, 'R5');
  const cards = await openCard(w);
  await sleep(1_000);
  expect([cards.length, await asksRaised(w)], 'one ask whose card names deep.trial, and no other').toEqual([1, 1]);
  expect(await Promise.race([settled, sleep(200).then(() => 'waiting')]), 'the extension waits for your answer').toBe('waiting');
  expect([decideByOf(t, TRIAL), extensionsOf(t, TRIAL)], 'nothing is on record until you answer').toEqual(['R3', []]);

  await answerCard(w, cards[0]!.ask, 'allow');
  expect(await settled, 'your yes settles the extension').toBe('extended');
  expect(await asksRaised(w), 'still one ask').toBe(1);
  expect(decideByOf(t, TRIAL), 'deep.trial\'s published decide_by is the new one').toBe('R5');
  const rows = extensionsOf(t, TRIAL);
  expect(rows, 'one extension on record for deep.trial').toHaveLength(1);
  expect(rows[0], 'recorded with its reason, the decide_by it moved from and to, and the ask you answered').toMatchObject({ entry: `api:${TRIAL}`, from: 'R3', to: 'R5', reason: REASON, ask: cards[0]!.ask });
  expectPass(check(t, 'R3'), 'the preflight in R3, deep.trial\'s first decide_by, with the extension on record');
}, 180_000);

it('#1802.9ef4dcb1 a new decide_by 3 releases later is refused, and so is a second extension of the same entry', async () => {
  const extend = await extender();
  const w = await openWorld();

  const far = trialTree();
  const tooFar = await refusal(extend, w, far, 'R6');
  expect(tooFar, 'R6 is 3 releases after R3: refused').toMatch(/^refused: /);
  expect(tooFar, 'the refusal names the entry').toContain(TRIAL);
  expect([await asksRaised(w), decideByOf(far, TRIAL), extensionsOf(far, TRIAL)], 'no ask is raised and nothing is recorded').toEqual([0, 'R3', []]);

  const once = trialTree();
  const first = request(extend, w, once, 'R4');
  await answerCard(w, (await openCard(w))[0]!.ask, 'allow');
  expect(await first, 'the first extension, R3 to R4').toBe('extended');
  const second = await refusal(extend, w, once, 'R5');
  expect(second, 'a second extension of deep.trial, R4 to R5: refused').toMatch(/^refused: /);
  expect(second, 'the refusal names the entry').toContain(TRIAL);
  expect([await asksRaised(w), decideByOf(once, TRIAL), extensionsOf(once, TRIAL).length], 'no second ask is raised and the record keeps the one extension').toEqual([1, 'R4', 1]);
}, 180_000);

it('#1802.9ef4dcb1 an agent\'s patch to decide_by is refused: a decide_by moved with no extension on record fails the preflight, naming the entry', () => {
  const t = emptyTree('patch');
  addApi(t, previewEntry(TRIAL, { preview_since: 'R1', decide_by: 'R3' }));
  record(t, 'R1');
  expectPass(check(t, 'R2'), 'the candidate R2 with deep.trial as R1 recorded it');
  editApi(t, TRIAL, (e) => { e.decide_by = 'R4'; });
  expectFailNaming(check(t, 'R2'), 'deep.trial\'s decide_by patched from R3 to R4 in the published data, with no extension on record', TRIAL);
}, 120_000);

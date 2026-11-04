// AC "A claim sent back with findings at lines 10 and 40 of `src/cart.ts`, whose next commit changes only line 10, is
// re-reviewed on that commit's change alone: the line-40 finding isn't sent again and stays the first send-back's
// open item, and no new item cites a line the commit didn't touch. A review that re-reads the whole diff each round
// and sends line 40 again fails this test, naming the finding."
// src/cart.ts is 45 lines. Commit A loosens the loop bound at line 10 (off-by-one) and empties the catch at line 40
// (swallowed-error); line 12, an unchecked JSON.parse there since the base, is a context line of both diffs. Commit B
// changes only line 10 back. The reviewer reads whatever diff it's given by rule.
import { describe, expect, it } from 'vitest';
import { history, type History, items, reviewSpec, ruleReviewer, runReview, shown } from './helpers.ts';

const CART = 'src/cart.ts';
const LINE_40 = '} catch {}';
const CART_LINE_12 = '  const saved = JSON.parse(raw);';

/** src/cart.ts: 45 lines whose base, A and B differ only at lines 10 and 40. */
function cart(line10: string, line40: string): string[] {
  const lines = Array.from({ length: 45 }, (_, i) => `  applyRule(cart, rules[${i}]);`);
  lines[0] = 'export async function checkout(cart: Cart, items: Item[], rules: Rule[], raw: string) {';
  lines[1] = '  let total = 0;';
  lines[9] = line10;
  lines[11] = CART_LINE_12;
  lines[12] = '  cart.restore(saved);';
  lines[37] = '  try {';
  lines[38] = '    await save(cart, total);';
  lines[39] = line40;
  lines[43] = '  return total;';
  lines[44] = '}';
  return lines;
}
const BOUND = '  for (let i = 0; i < items.length; i++) total += items[i].price;';
const PAST_END = '  for (let i = 0; i <= items.length; i++) total += items[i].price;';
const CAUGHT = "  } catch (err) { report('cart save failed', err); }";
/** The base, A (lines 10 and 40 broken) and B (only line 10 fixed). */
const cartHistory = (): History => history({ [CART]: cart(BOUND, CAUGHT) }, [
  { label: 'A', files: { [CART]: cart(PAST_END, `  ${LINE_40}`) } },
  { label: 'B', files: { [CART]: cart(BOUND, `  ${LINE_40}`) } },
]);

describe("AC a re-review reads only what changed since the commit it last reviewed, and doesn't send an open item again", () => {
  it('round 2 on B reads only A..B: the line-40 finding stays the first send-back\'s open item and no new item cites a line B didn\'t touch', async () => {
    const h = cartHistory();

    const round1 = await runReview(ruleReviewer().reviewer, reviewSpec(h.sha.base!, h.sha.A!), h.checkout);
    expect(items(round1.sendBack?.items), `round 1: ${shown(round1)}`).toEqual([
      { rule: 'off-by-one', sites: [[CART, 10, 'for (let i = 0; i <= items.length; i++) total += items[i].price;']] },
      { rule: 'swallowed-error', sites: [[CART, 40, LINE_40]] },
    ]);

    const reviewer = ruleReviewer();
    const round2 = await runReview(reviewer.reviewer, reviewSpec(h.sha.base!, h.sha.B!, { commit: h.sha.A!, items: round1.sendBack!.items }), h.checkout);

    expect(reviewer.requests.length).toBe(1);
    const given = reviewer.requests[0]!.diff;
    expect(given.includes(LINE_40), `round 2 is given only A..B, yet its diff holds line 40's "${LINE_40}":\n${given}`).toBe(false);
    expect(given.includes('i < items.length'), `round 2's diff holds B's change at line 10:\n${given}`).toBe(true);

    const resent = (round2.sendBack?.items ?? []).flatMap((i) => i.sites.filter((s) => s.file === CART && s.line === 40).map(() => i.rule));
    expect(resent, `swallowed-error at ${CART}:40 quoting "${LINE_40}" is sent again: ${shown(round2)}`).toEqual([]);
    expect(items(round2.open), `swallowed-error at ${CART}:40 stays the first send-back's open item: ${shown(round2)}`)
      .toContainEqual({ rule: 'swallowed-error', sites: [[CART, 40, LINE_40]] });

    const untouched = (round2.sendBack?.items ?? []).flatMap((i) => i.sites.filter((s) => !(s.file === CART && s.line === 10)).map((s) => `${i.rule} at ${s.file}:${s.line}`));
    expect(untouched, `new items cite lines B didn't touch (B changed only ${CART}:10; line 12 is "${CART_LINE_12.trim()}"): ${shown(round2)}`).toEqual([]);
  }, 60_000);
});

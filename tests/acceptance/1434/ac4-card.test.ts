// Criterion 4 (README: Criteria to tests): a planted effect over the question card. `flare` is a node with no fill of its
// own, painted in GPUI's deferred pass (after the rest of the window, the card included, as a popover is), whose frost@1
// slot covers the card's slot. It must be refused, with a refusal naming the effect and the card, and the card's pixels
// must be byte-equal to the same window drawn with that effect omitted. The wrong program, the guard switched off
// (DEEP_CHROME_PLANT=no_card_guard), draws the darkening frost over the card: no refusal, and the card's pixels change,
// which shows the byte comparison can see an effect over the card.
import { describe, expect, it } from 'vitest';
import { at, differing, fixture, replica, useBuild, type Rect } from './helpers.ts';

const bin = useBuild('replica');
const CARD = fixture('card.json');
const SLOT = (CARD['card'] as { rect: Rect }).rect;

describe('#1434 AC4 a planted effect over the question card is refused, and the card\'s pixels are byte-equal to its render with no effect', () => {
  it('AC4 the effect is refused, naming the effect and the card, and every pixel of the card equals the window drawn without the effect', () => {
    const planted = replica(bin(), CARD);
    const clean = replica(bin(), CARD, { omit: ['flare'] });
    const refusal = planted.refusals.find((r) => r.effect === 'flare');
    expect(refusal, `a refusal names the effect: ${JSON.stringify(planted.refusals)}`).toBeDefined();
    expect(refusal!.over, 'the refusal names the card').toBe('card');
    expect(refusal!.operator, 'and the operator the effect ran').toBe('frost@1');
    // The card is drawn: its slot is not one flat color.
    const first = at(clean.png, SLOT[0] + 1, SLOT[1] + 1).join();
    let flat = true;
    for (let y = SLOT[1]; y < SLOT[1] + SLOT[3] && flat; y++) for (let x = SLOT[0]; x < SLOT[0] + SLOT[2]; x++) if (at(clean.png, x, y).join() !== first) { flat = false; break; }
    expect(flat, 'the card draws its question and options in its slot').toBe(false);
    expect(differing(planted.png, clean.png, SLOT), 'the card\'s pixels with the refused effect against its render with no effect').toEqual([]);
    expect(clean.refusals, 'the window with no effect over the card refuses nothing').toEqual([]);
  }, 600_000);

  it('AC4 with the guard switched off (DEEP_CHROME_PLANT=no_card_guard) the effect draws over the card, and the card\'s pixels differ', () => {
    const unguarded = replica(bin(), CARD, { plant: 'no_card_guard' });
    const clean = replica(bin(), CARD, { omit: ['flare'] });
    expect(unguarded.refusals, 'the unguarded renderer refuses nothing').toEqual([]);
    expect(differing(unguarded.png, clean.png, SLOT).length, 'the frost over the card changes its pixels').toBeGreaterThan(0);
  }, 600_000);
});

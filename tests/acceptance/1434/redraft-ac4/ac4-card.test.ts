// Criterion 4, blind redraft (README.md here): a planted effect over the question card. `flare` (../fixtures/card.json,
// unchanged) is a deferred node with no fill of its own whose frost@1 slot covers the card's slot. The guard refuses it
// by where it is, not by when it paints, and records a refusal naming the effect and the card; the card's pixels are
// byte-equal to the same window drawn with that effect omitted. GPUI paints the card as the window's prompt, after every
// deferred draw, so an effect in its element's paint order lands under the opaque card and can't change it: the wrong
// program the pixel check must catch is one whose effect escapes that order and composites above the card, with nothing
// refused (DEEP_CHROME_PLANT=effect_above_card).
import { describe, expect, it } from 'vitest';
import { at, differing, fixture, replica, useBuild, type Plant, type Rect } from '../helpers.ts';

const bin = useBuild('replica');
const CARD = fixture('card.json');
const SLOT = (CARD['card'] as { rect: Rect }).rect; // scale 1: points are device px
const AREA = SLOT[2] * SLOT[3];
// Named in README.md here; not in ../helpers.ts's Plant list, which this redraft doesn't edit.
const EFFECT_ABOVE_CARD = 'effect_above_card' as string as Plant;

describe('#1434 AC4 (redraft) a planted effect over the question card is refused, and the card\'s pixels are byte-equal to its render with no effect', () => {
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

  it('AC4 a planted program whose effect composites above the card and is not refused (DEEP_CHROME_PLANT=effect_above_card) fails both checks', () => {
    const wrong = replica(bin(), CARD, { plant: EFFECT_ABOVE_CARD });
    const clean = replica(bin(), CARD, { omit: ['flare'] });
    expect(wrong.refusals.find((r) => r.effect === 'flare'), `the wrong program refuses nothing for flare: ${JSON.stringify(wrong.refusals)}`).toBeUndefined();
    // The frost's tint (0, 0, 64, 128) halves the card's red and green wherever it lands, so it changes most of the slot,
    // not a stray pixel: the byte comparison above sees an effect drawn over the card.
    const changed = differing(wrong.png, clean.png, SLOT, AREA);
    expect(changed.length, `the effect over the card changes at least half its slot's ${AREA} pixels; first: ${changed.slice(0, 3).join('; ')}`).toBeGreaterThanOrEqual(AREA / 2);
  }, 600_000);
});

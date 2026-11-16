// AC3 #903.92244161: "A key on a control in a card over 3D that rides a moving part: the pointer reaches the card's
// anchor within 1 px at the key's time."
//
// Through `deep-show run` (the full set: the scene, the card over it and the tour in one document) and `eval` with
// `tour_pointer: true` (README: The surface under test). The fixture is the riding card (helpers.ts: cardDoc): a cart
// whose position a channel moves from (−1.5, 0.5, 0) m at 0 s to (1.5, 1.5, 0) m at 4 s, seen by a pinhole camera from
// (0, 1.6, 6) m toward (0, 1, 0) m, 50° across the 640 px frame; the card `overlay.frame@1`, anchored to the cart's
// point at offset (−60, −40) px, holding a 120 × 80 px frame whose button's box is (40, 20, 40, 40) px; the toggle
// `card-switch`, hit through that button; and a tour that keys it once, at 3 s. The button's centre sits on the
// projection of the cart's point, so the control's anchor and the card's own anchor are one place: at 3 s the cart is
// at (0.75, 1.25, 0) m, which projects to (405.708, 151.572) px.
//
// asserts:
//   - `eval` at 3 s reads a pointer that draws, its tip within 1 px of that place, worked out here from the document;
//   - the fixture's guard: half a second earlier, when the glide begins, the card is 45 px away, so a pointer aimed at
//     where the card was is caught.
// Wrong programs: the base (its check refuses a document's `tour`, and `eval` reads no pointer); a pointer that takes
// the control's place from the layout when its glide begins, or from the card's frame where it was authored; one that
// skips a control drawn on a card.
import { describe, expect, it } from 'vitest';
import { AC, CARD, DOC, TIMEOUT, at, cardAnchor, cardDoc, dist, fl, gate, none, offBy, prebuild, present, presented, runShow, scenario, show, useTemp } from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(3);

describe(`${AC[3]} a control on a card that rides a moving part`, () => {
  it(`${AC[3]} at the key's time the pointer reaches the card's anchor within 1 px, where the moving part has carried the card`, () => {
    const want = cardAnchor(CARD.key);
    const before = cardAnchor(CARD.key - 0.5);
    expect(dist(want, before), `the fixture: the card moves at least 20 px over the glide, from ${at(before)} at 2.5 s to ${at(want)} at 3 s`).toBeGreaterThanOrEqual(20);
    expect(want[0] > 84 && want[0] < CARD.size[0] - 84 && want[1] > 64 && want[1] < CARD.size[1] - 64, `the fixture: the card lies inside the safe frame at 3 s, centred on ${at(want)}`).toBe(true);

    const calls = [present(D, cardDoc('riding-card')), { call: 'eval', doc: D, t: fl(CARD.key), tour_pointer: true }];
    const [shown, read] = runShow(scenario(temp(), [D], calls), 'the riding card');
    presented(shown, 'the riding card');
    gate(read!, 'eval of the riding card at 3 s');
    expect(read!['outcome'], `eval of the riding card at 3 s is evaluated: ${show(read, 800)}`).toBe('evaluated');
    const off = offBy(read!['tour_pointer'], want, 'the key on card-switch at 3 s', "the card's anchor, the cart's point projected,");
    none(off === null ? [] : [off], 'the pointer on the card over 3D');
  }, TIMEOUT);
});

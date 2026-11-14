// AC5, its last clause: "its close button is reached by Tab and closes the card on Enter". The card is the criterion's:
// "A card frame with a title, an image and a close button, anchored to a lamp" in a 3D room.
//
// The fixture (helpers.ts: roomDoc): the room seen by a still camera, the card `overlay.frame@1` `card` holding a
// 160 × 100 px frame (background `card-bg` in the role `accent`, title "Reading lamp", a 64 × 48 PNG kept in the
// evidence store, and the close button `card-close`, drawn for the view-class toggle `close-card` bound to
// `items/card/visible`), anchored to the lamp's point at offset (0, 0). `deep show` presents it in the panel `main`.
//
// asserts, through `deep-show run` (the scope, on #383's virtual clock):
//   - Tab, pressed until the scope's `focus` is `close-card` (found in a first run, at most 8 presses);
//   - the panel's `view` shows the card's background (at least 2,000 pixels within 2 code values of `accent`) before
//     any key, and still after those Tabs: moving the focus closes nothing;
//   - then Enter: the panel's `view` shows none of the card's background.
// Wrong programs it fails: the base (its deep-show refuses the card's overlay.frame@1 as module_missing; past that,
// Enter acts only on a focused pick target, so the card would stay: BASE-FAILURE.txt); a close button Tab
// skips; Enter that doesn't press the focused control; Tab that presses it; a view that doesn't draw the card; a
// press that hides the button but leaves the card drawn.
import { describe, expect, it } from 'vitest';
import { AC5, Calls, TIMEOUT, cardImage, cardPixels, focusOf, presented, putEvidence, requireGpu, roomDoc, runShow, scenarioOf, snapshotOf, useDeepShow, useDir } from './helpers.ts';

const deepShow = useDeepShow();
const dir = useDir();
const MAX_TABS = 8;
const SHOWN = 2000;

describe(`${AC5} the card's close button`, () => {
  it(`${AC5} the card's close button is reached by Tab and closes the card on Enter`, () => {
    requireGpu();
    const evidence = dir();
    const room = roomDoc(putEvidence(evidence, cardImage()));

    // How many Tabs put the focus on the close button.
    const probe = new Calls(room);
    const after: number[] = [];
    for (let k = 0; k < MAX_TABS; k++) { probe.key('Tab'); after.push(probe.scope()); }
    const first = runShow(deepShow(), scenarioOf(evidence, probe), 'Tab through the room');
    presented(first[0], 'the room');
    const foci = after.map((i, k) => focusOf(first[i], `the scope after Tab ${k + 1}`));
    const tabs = foci.indexOf('close-card') + 1;
    expect(tabs, `Tab reaches the card's close button within ${MAX_TABS} presses; the focus after each: ${JSON.stringify(foci)}`).toBeGreaterThan(0);

    // The view before, Tab to the close button, the view again, then Enter and the view after it.
    const c = new Calls(room);
    const before = c.view();
    for (let k = 0; k < tabs; k++) c.key('Tab');
    const focused = c.scope();
    const tabbed = c.view();
    const enter = c.key('Enter');
    const closed = c.view();
    const r = runShow(deepShow(), scenarioOf(evidence, c), 'Tab to the close button, then Enter');
    presented(r[0], 'the room');
    expect(focusOf(r[focused], 'the scope after the Tabs'), `${tabs} Tabs put the focus on the close button`).toBe('close-card');
    const shown = cardPixels(snapshotOf(evidence, r[before], 'the view before any key'));
    expect(shown, "the view shows the card before any key (pixels of the card's background)").toBeGreaterThanOrEqual(SHOWN);
    const still = cardPixels(snapshotOf(evidence, r[tabbed], 'the view with the close button focused'));
    expect(still, "Tab only moves the focus: the view still shows the card (pixels of the card's background)").toBeGreaterThanOrEqual(SHOWN);
    const gone = cardPixels(snapshotOf(evidence, r[closed], 'the view after Enter'));
    expect(gone, `Enter on the close button closes the card: pixels of its background after it (the Enter reply: ${JSON.stringify(r[enter]).slice(0, 600)})`).toBe(0);
  }, TIMEOUT);
});

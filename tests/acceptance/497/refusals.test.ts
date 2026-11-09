// Criterion 1 (its refusals): "… a step rate of 85 Hz is refused, naming it; and lag over that array with dt −0.5 s is
// refused as a look-ahead, naming the driver"
//
// Through `deep-show run`, built with `test-held` (README: The test canvas module). deep_show checks each board: one
// whose `test.held@1` item steps at 85 Hz (705,600,000 ÷ 85 is no whole number of flicks) is refused with `bad_rate`
// naming 85, while one at 120 Hz is presented; one whose driver `d_held` reads `lag(n, "-0.5s")` with `n` the held
// array `test.held.index` is refused as a look-ahead naming `d_held`, while the same look-ahead over an item's
// position (no stepping module writes it) is presented. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, heldBoard, mentions, presented, rect, refusedIssues, run, scenario, show as text, showDoc, useEvidence, useHeldShow, type JsonObject } from './helpers.ts';

const show = useHeldShow();
const evidence = useEvidence();

const POINTS = [rect('dot', [0, 0, 10, 10], 'a2', { at: { pos: [16, 120, 0] } }), rect('src', [0, 0, 10, 10], 'a3', { at: { pos: [40, 120, 0] } })];
const lagBoard = (title: string, id: string, read: string): JsonObject =>
  heldBoard(title, 50, 60, { items: POINTS, drivers: { [id]: { target: 'items/dot/at/pos/0', expr: 'lag(n, "-0.5s")', vars: { n: read } } } });

describe(`${AC[1]} a step rate without a whole-flick step, and a look-ahead through a held array, are refused`, () => {
  it(`${AC[1]} 85 Hz is refused naming the rate while 120 Hz is presented; lag over the held array with dt −0.5 s is refused as a look-ahead naming the driver, while the same lag over a position is presented`, () => {
    const replies = run(show(), scenario(evidence(), [
      showDoc(1, heldBoard('Held index at 85 Hz', 85, 60)),
      showDoc(2, heldBoard('Held index at 120 Hz', 120, 60)),
      showDoc(3, lagBoard('Look-ahead through the held array', 'd_held', 'test.held.index')),
      showDoc(4, lagBoard('Look-ahead through a position', 'd_pos', 'items/src/at/pos/0')),
    ]));
    const rate = refusedIssues(replies[0]!, 'the 85 Hz board').filter((i) => i['code'] === 'bad_rate' && mentions(i, 'step_rate'));
    expect(rate.length, `the 85 Hz board is refused with a bad_rate error at the item's step_rate: ${text(replies[0])}`).toBeGreaterThan(0);
    expect(rate.some((i) => mentions(i, '85')), `the bad_rate error names 85: ${text(rate)}`).toBe(true);
    presented(replies[1]!, 'the 120 Hz board');
    const ahead = refusedIssues(replies[2]!, 'the look-ahead through the held array').filter((i) => /look.?ahead/i.test(JSON.stringify(i)));
    expect(ahead.length, `the board is refused as a look-ahead: ${text(replies[2])}`).toBeGreaterThan(0);
    expect(ahead.some((i) => mentions(i, 'd_held')), `the look-ahead refusal names the driver d_held: ${text(ahead)}`).toBe(true);
    presented(replies[3]!, 'the look-ahead through a position');
  }, TIMEOUT);
});

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALPHA, CARD, CARD_RECT, DOC, PANELS, SESSIONS, WINDOW, board, cardFailures, expectBadInput, outcome, pixel, screen, useEvidence,
  useShowBinary, type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

/** Inside the card, this far from its edge, so rounded corners and the edge's antialiasing are left out. */
const INSET = 16;
const [W, H] = WINDOW;
/** An agent document whose one item has the highest order key and bounds 100 times the window. */
const FLOOD = board('Flood', [W, H], [
  { id: 'flood', kind: 'rect@1', name: 'Flood', order: 'zzzzzzzz', params: { box: [-50 * W, -50 * H, 100 * W, 100 * H], paint: { fill: { role: 'ink' } } } },
]);

const scenario = (calls: JsonObject[], planted?: string): JsonObject => ({
  evidence: evidence(), sessions: SESSIONS, panels: PANELS, docs: { [DOC.a]: { panel: 'main' } }, window: WINDOW, card: CARD, calls, ...(planted ? { planted } : {}),
});
const flood = (): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: FLOOD, include: ['issues'] });

describe('AC8 an agent document with the highest order key and bounds 100 times the window leaves the card\'s interior pixels equal to its isolated render', () => {
  it('AC8 the agent\'s flood draws in its panel but never over the card: the card\'s interior equals its isolated render', () => {
    const isolated = screen(scenario([]), join(evidence(), 'isolated.png'));
    const full = screen(scenario([flood()]), join(evidence(), 'full.png'));
    expect(outcome(full.replies[0]!), 'the agent\'s document is presented').toBe('presented');
    // The flood really drew: beside the card, inside the panel, the window differs from the card alone.
    const [x, y] = [CARD_RECT[0] - 40, CARD_RECT[1] + 40];
    expect(pixel(full.image, x, y), 'beside the card the agent\'s document draws').not.toEqual(pixel(isolated.image, x, y));
    expect(cardFailures(full, isolated, CARD_RECT, INSET), 'every interior pixel of the card is its isolated render\'s').toEqual([]);
  }, 300_000);

  it('AC8 a compositor that sorts by order key alone draws above the card and fails, naming the item', () => {
    const isolated = screen(scenario([]), join(evidence(), 'isolated.png'));
    const planted = screen(scenario([flood()], 'sorts_by_order_key_alone'), join(evidence(), 'planted.png'));
    const failures = cardFailures(planted, isolated, CARD_RECT, INSET);
    expect(failures.length, 'the check fails on the planted compositor').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the item').toContain('flood');
  }, 300_000);

  it('deep-show screen answers bad_input to a line it can\'t read, and to one with no out', () => {
    // A line is read before anything platform-specific, so this holds on every platform.
    expectBadInput('screen', scenario([]));
  });
});

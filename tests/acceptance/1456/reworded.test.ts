// AC1 #1456.aa4dd611: every reading string in the fixture is reworded, and every session's state is unchanged. The
// fixture's records, each in a hub of its own (README: The fixture): its readings in the base's words with their codes,
// and the same readings reworded with the same codes. Each session's newest session.state must be the one the merge base
// reads from the base's own words (the fixture's `expected`), in both. At the merge base the reworded record moves the
// sessions whose state a reading's words decide, and the test names each one.
import { afterAll, describe, expect, test } from 'vitest';
import { AC1, beside, cleanup, moved, SESSIONS, statesOf } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(AC1, () => {
  test(`${AC1}: every reading reworded, every session's state unchanged`, async () => {
    expect(SESSIONS.every((s) => s.steps.every((step) => !('text' in step) || (step.reworded !== step.text && !step.reworded.startsWith(step.text.slice(0, 12))))), 'the fixture rewords every reading').toBe(true);
    const original = await statesOf('coded');
    const reworded = await statesOf('reworded');
    const proof = `${beside('the base\'s words, with codes', original.states)}\n${beside('reworded, with the same codes', reworded.states)}`;
    console.log(proof);
    expect(moved(reworded.states), `the sessions whose state moved when their readings were reworded:\n${proof}`).toEqual([]);
    expect(moved(original.states), `the sessions whose state moved from the base's, on the base's own words with codes:\n${proof}`).toEqual([]);
    expect({ original: original.refused, reworded: reworded.refused }, `the record takes each reading with its code as session.reading@2: ${original.firstRefusal ?? reworded.firstRefusal ?? ''}`).toEqual({ original: 0, reworded: 0 });
  }, 300_000);
});

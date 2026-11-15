// Criterion 3 #1810.1a3e8cda: a status answer for a session with a 90-character title and 3 open asks is no wider than
// #83's width and still ends in the count. On the merge base the count is appended after the cut and the test fails,
// naming the width. The session's Stop made its claim, so the answer's line is #83's verdict line (README, The fixture),
// cut to the width; the count must be part of the line before the cut.
import { afterAll, describe, expect, test } from 'vitest';
import { cleanup, countFailures, ID, makeWorld, statusAnswer, WIDTH, widthFailures } from './helpers.ts';

afterAll(cleanup, 60_000);

/** Exactly 90 characters. */
export const TITLE = 'Move the cart totals, the tax lines and the shipping estimates onto the one checkout pages';

describe(ID.width, () => {
  test(`${ID.width}: a session with a 90-character title and 3 open asks: the status answer's line is at most ${WIDTH} columns and ends in "needs you: 3"`, async () => {
    expect([...TITLE].length, 'the fixture title is 90 characters').toBe(90);
    const options: [string, string][] = [['yes', 'Yes'], ['no', 'No']];
    const w = await makeWorld({
      title: TITLE,
      asks: [
        { question: 'Ship the cart page today?', options, default: 'no', then: 'open' },
        { question: 'Keep the old checkout button?', options, default: 'no', then: 'open' },
        { question: 'Show the tax line before shipping?', options, default: 'no', then: 'open' },
      ],
    });
    const answer = await statusAnswer(w);
    console.log(`status answer:\n${answer}`);
    expect([...widthFailures(answer, 3), ...countFailures(answer, w.asks)], 'the status answer fits the width and ends in its count').toEqual([]);
  }, 600_000);
});

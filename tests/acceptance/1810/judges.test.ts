// The judges each criterion's failure message comes from, held to a right answer and to wrong ones, so none passes
// everything. No hub, no criterion tag: it runs anywhere and passes at the base.
import { describe, expect, test } from 'vitest';
import { countFailures, widthFailures, type FixtureAsk } from './helpers.ts';

const asks: FixtureAsk[] = [
  { handle: 'ask:01M7F3ZCNHSH05082ADMYHMJSA', question: 'Keep the cart on SQLite or plain files?', then: 'default' },
  { handle: 'ask:01M7F3ZCNHSH05082ADMYHMJSB', question: 'Ship the cart page today?', then: 'answer' },
  { handle: 'ask:01M7F3ZCNHSH05082ADMYHMJSC', question: 'Which header colour on the login page?', then: 'open' },
];
const line = (count: number, head = 'says done · next: DeepBuild') => `${head} (for 10s) · needs you: ${count}\nwork: /tmp/x · session 52ec5524 (claude-code)`;

describe('judges', () => {
  test('the count judge passes the open count, and names the count and the closed asks of a count over it', () => {
    expect(countFailures(line(1), asks)).toEqual([]);
    const three = countFailures(line(3), asks).join('\n');
    expect(three).toContain('"needs you: 3"');
    for (const a of asks.filter((x) => x.then !== 'open')) expect(three).toContain(a.handle);
    // A reader that counts the undoable default (criterion 2's plant) is named by the ask.
    expect(countFailures(line(2), asks).join('\n')).toContain(asks[0]!.handle);
    expect(countFailures('says done · next: DeepBuild (for 10s)', asks)).toHaveLength(1);
  });

  test('the width judge passes a line within 80 columns that ends in the count, and names the width or the missing count', () => {
    expect(widthFailures(line(3), 3)).toEqual([]);
    const wide = widthFailures(line(3, `says done · next: DeepBuild · session/ab54e4db/01M7F40FC186KG1BY2N01DVW66`), 3).join('\n');
    expect(wide).toContain('98 columns wide, over #83\'s width of 80');
    expect(widthFailures('says done · next: DeepBuild · needs you: 3 · session/ab54e4db', 3).join('\n')).toContain('doesn\'t end in "needs you: 3"');
  });
});

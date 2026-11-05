// AC3: a Playwright run whose `toHaveText` assertion received "$18.00" against "$18.01", bound with `format.unit: USD`:
// the bound values show 18.01 and 18.00. A run whose received value is "N/A" reads missing with `not_reported`, never 0;
// the planted resolver that turns an unparsable value into 0 fails the same check, naming the bound value. The reports
// are Playwright's JSON reporter's shape (fixtures/playwright-cart-*.json, README: Fixtures). At the base `deep-show
// run` has no `run` call and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ASSERTION, ENDED, PLAYWRIGHT_NA_RUN, PLAYWRIGHT_RUN, RECORDED_AT, copied, entryOf, find, framesOf, readsMissing, runShow, scenario,
  secs, showsValue, useBuilds, useTemp, type BoundText, type Planted, type World,
} from './helpers.ts';

const build = useBuilds(['deep-show']);
const temp = useTemp();

const USD = { unit: 'USD' };
/** The unit shown: the dollar sign or the code. */
const DOLLARS = /\$|USD/;
const bound = (run: string): BoundText[] => [
  { id: 'expected', bind: { source: `${run}#${ASSERTION}`, select: 'expected', format: USD } },
  { id: 'received', bind: { source: `${run}#${ASSERTION}`, select: 'received', format: USD } },
];
const world = (evidence: string, run: string, report: string, planted?: Planted): World => ({
  evidence, bound: bound(run), ...(planted ? { planted } : {}),
  runs: [{ at: RECORDED_AT, run: { run, check: 'cart-e2e', tool: 'playwright', report, ended: ENDED } }],
});

describe('AC3 a Playwright toHaveText assertion\'s dollar amounts, and a received value that isn\'t a number', () => {
  it('AC3 received "$18.00" against "$18.01" with format.unit USD: the record entry holds both as printed, and the bound values show 18.01 and 18.00 in dollars (fails on a resolver that drops the cents the report printed, or reads the locator\'s call log)', () => {
    const s = scenario(world(temp(), PLAYWRIGHT_RUN, copied(temp(), 'playwright-cart-failed.json')));
    const replies = runShow(build('deep-show'), s, 'the failing Playwright run');
    const entry = entryOf(replies[1], 'the run call');
    const cart = entry.assertions.find((a) => a.assertion === ASSERTION);
    expect(cart, `the record entry lists ${JSON.stringify(ASSERTION)}: ${JSON.stringify(entry.raw).slice(0, 800)}`).toBeDefined();
    expect(cart!.outcome, 'cart total failed').toBe('failed');
    expect(cart!.expected ?? '', 'the expected value\'s raw bytes hold the "$18.01" Playwright printed').toContain('$18.01');
    expect(cart!.received ?? '', 'the received value\'s raw bytes hold the "$18.00" Playwright printed').toContain('$18.00');
    const f = framesOf(s, replies, 'the failing Playwright run').flatMap((fr) => [
      ...showsValue(find(fr.bound, 'expected'), { element: 'expected', source: PLAYWRIGHT_RUN, shows: '18.01', value: 18.01, asOf: ENDED, unit: DOLLARS }, `in the frame at ${secs(fr.at)}`),
      ...showsValue(find(fr.bound, 'received'), { element: 'received', source: PLAYWRIGHT_RUN, shows: '18.00', value: 18, asOf: ENDED, unit: DOLLARS }, `in the frame at ${secs(fr.at)}`),
    ]);
    expect(f, 'the two bound values at every frame').toEqual([]);
  });

  /** The criterion's check on the N/A run, as failures each naming its bound value. */
  function notApplicable(planted?: Planted): string[] {
    const s = scenario(world(temp(), PLAYWRIGHT_NA_RUN, copied(temp(), 'playwright-cart-na.json'), planted));
    const replies = runShow(build('deep-show'), s, `the N/A Playwright run${planted ? ` (planted ${planted})` : ''}`);
    const entry = entryOf(replies[1], 'the run call');
    const cart = entry.assertions.find((a) => a.assertion === ASSERTION);
    const f: string[] = [];
    if (!cart) f.push(`the record entry lists no assertion ${JSON.stringify(ASSERTION)}`);
    else if (!(cart.received ?? '').includes('N/A')) f.push(`the record entry's received ${JSON.stringify(cart.received)} isn't the "N/A" Playwright printed`);
    for (const fr of framesOf(s, replies, 'the N/A Playwright run')) {
      f.push(...showsValue(find(fr.bound, 'expected'), { element: 'expected', source: PLAYWRIGHT_NA_RUN, shows: '18.01', value: 18.01, asOf: ENDED, unit: DOLLARS }, `in the frame at ${secs(fr.at)}`));
      f.push(...readsMissing(find(fr.bound, 'received'), 'received', PLAYWRIGHT_NA_RUN, `in the frame at ${secs(fr.at)}`));
    }
    return f;
  }

  it('AC3 a received value "N/A" reads missing with not_reported, naming the run and the assertion, never 0, while the expected 18.01 still shows; the planted resolver that turns an unparsable value into 0 fails, naming the bound value', () => {
    expect(notApplicable(), 'the N/A run').toEqual([]);
    // The wrong program the proof line names: an unparsable value read as 0.
    const wrong = notApplicable('unparsable_reads_zero');
    expect(wrong.length, 'the check fails on the resolver that reads "N/A" as 0').toBeGreaterThan(0);
    expect(wrong.every((w) => w.startsWith('bound value received')), `every failure names the bound value received: ${JSON.stringify(wrong)}`).toBe(true);
    expect(wrong.some((w) => /value 0|the value 0|shows a number/.test(w)), `a failure says it shows 0: ${JSON.stringify(wrong)}`).toBe(true);
  });
});

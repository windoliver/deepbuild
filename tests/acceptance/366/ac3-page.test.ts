// AC3: a stock's page opens from ⌘K with the stock as its parameter (README, Readings: AC3). In a replica launched
// from #338's fixture with the stocks view's panel and registration, ⌘K is asked for "NVDA"; its entry "Stock: NVDA"
// is clicked, and the view's panel, mounted as that page, must draw "Stock page: NVDA". The wrong program is the
// replica planted to open a page without its parameter (DEEP_DRIVE_PLANT=page-drops-param), which draws
// "Stock page: (none)".
import { afterAll, describe, expect, it } from 'vitest';
import { Drive, drawn, launchStocks, query, stopAll } from './drive.ts';
import { ID, tempDir } from './helpers.ts';
import { pageProblems, type PageRun } from './judges.ts';

const ENTRY = 'Stock: NVDA';
const TEXT = 'Stock page: NVDA';

async function open(plant?: string): Promise<PageRun> {
  const d = await Drive.start(tempDir('home3'), plant);
  try {
    await launchStocks(d);
    const main = await drawn(d, 'Watchlist');
    expect(main, 'the view shows its main page before ⌘K').toBe(true);
    const entries = await query(d, 'NVDA');
    const click = await d.call({ call: 'act', locator: { role: 'list_box_option', name: ENTRY }, act: { kind: 'click' } });
    await d.must({ call: 'wait_for', wait_for: { state: 'settled' } });
    return { entries, clicked: click.ok ? null : JSON.stringify(click.error ?? click), shown: await drawn(d, TEXT), main: await drawn(d, 'Watchlist') };
  } finally {
    await d.stop();
  }
}

afterAll(stopAll);

describe(`AC3 ${ID.ac3} A stock's page opens from ⌘K with the stock as its parameter`, () => {
  it('AC3 ⌘K for NVDA lists the Stock page for NVDA, and choosing it opens the page with NVDA as its symbol', async () => {
    expect(pageProblems(await open(), ENTRY, TEXT)).toEqual([]);
  }, 300_000);

  it('AC3 (wrong program) a replica that opens the page without its parameter fails, naming the page', async () => {
    const problems = pageProblems(await open('page-drops-param'), ENTRY, TEXT);
    expect(problems.some((p) => p.includes(ENTRY) && p.includes('parameter')), JSON.stringify(problems)).toBe(true);
  }, 300_000);
});

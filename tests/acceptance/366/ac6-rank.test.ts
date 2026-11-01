// AC6: ⌘K ranks the same way every time from the same state (README, Readings: AC6). A replica launched from #338's
// fixture with the stocks view registered is asked three queries twice, and each registered command and page by its
// exact name. Then the live app's recency file is written, as the live app keeps it after you used three entries, and
// a second replica, on the same HOME, is asked the same queries: it must give the first replica's order, since a
// replica's recency list starts empty. The wrong program is the replica planted with a ranker that reads the live
// app's recency file (DEEP_DRIVE_PLANT=ranks-by-live-recency).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Drive, launchStocks, NAMES, RECENCY, ranked, stopAll } from './drive.ts';
import { ID, tempDir } from './helpers.ts';
import { rankProblems, type RankRun } from './judges.ts';

const QUERIES = ['Add', 'Stock', 'a'];
/** What the live app's recency file holds once you used these, most recent first. */
const USED = ['Add alert above target', 'Stock: AMD', 'Read prices'];

async function rank(plant?: string): Promise<RankRun> {
  const home = tempDir('home6');
  mkdirSync(dirname(RECENCY(home)), { recursive: true });
  const run: RankRun = { first: {}, second: {}, exact: {} };
  const a = await Drive.start(home, plant);
  try {
    await launchStocks(a);
    for (const q of QUERIES) run.first[q] = [await ranked(a, q), await ranked(a, q)];
    for (const name of NAMES) run.exact[name] = await ranked(a, name);
  } finally {
    await a.stop();
  }
  writeFileSync(RECENCY(home), `${JSON.stringify({ recent: USED })}\n`);
  const b = await Drive.start(home, plant);
  try {
    await launchStocks(b);
    for (const q of QUERIES) run.second[q] = await ranked(b, q);
    for (const name of NAMES) {
      const top = (await ranked(b, name))[0];
      if (top !== name) run.exact[name] = [top ?? '(nothing)', ...(run.exact[name] ?? [])];
    }
  } finally {
    await b.stop();
  }
  return run;
}

afterAll(stopAll);

describe(`AC6 ${ID.ac6} In a replica launched from a fixture, the same ⌘K query twice gives the same order, and each registered command and page is first for its exact name; a planted ranker that reads the live app's recency file gives another order in a second replica and fails, naming the command`, () => {
  it('AC6 the same query twice gives the same order, a second replica after the live app used three entries gives it again, and each command and page is first for its exact name', async () => {
    expect(rankProblems(await rank(), NAMES)).toEqual([]);
  }, 600_000);

  it('AC6 (wrong program) a ranker that reads the live app\'s recency file gives another order in the second replica and fails, naming the command', async () => {
    const problems = rankProblems(await rank('ranks-by-live-recency'), NAMES);
    // Named by an entry the live app used: the one the planted ranker moved up.
    expect(problems.some((p) => /second replica gave another order|isn't first for its exact name/.test(p) && USED.some((u) => p.includes(u))), JSON.stringify(problems)).toBe(true);
  }, 600_000);
});

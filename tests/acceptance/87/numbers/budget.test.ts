// Budgets, the numbers half: a numbers re-run within twice the original query's time. The merge base has no numbers
// kind, so the base side is the original query itself, run as the dashboard runs it (open the file read-only, run the
// query, close). Each side runs five times, interleaved, and the fastest of each is compared, so the shared machine's
// load slows both alike (README: Readings).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { context, database, numbers, numbersSpec, shown, tempDir } from './helpers.ts';

const RUNS = 5;
const EVENTS = [
  'CREATE TABLE events (id INTEGER PRIMARY KEY, account INTEGER NOT NULL, amount INTEGER NOT NULL);',
  'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300000) INSERT INTO events (id, account, amount) SELECT i, i % 997, (i * 7919) % 1000 FROM n;',
].join(' ');
/** Distinct account and amount pairs: a query that takes a few hundred ms on the reference Macs. */
const QUERY = 'SELECT COUNT(DISTINCT account * 1000 + amount) AS pairs FROM events';

describe('budgets: a numbers re-run within twice the original query\'s time', () => {
  it('re-running a dashboard number on 300,000 rows takes at most twice the query\'s own time, fastest of five each', async () => {
    const checkout = tempDir();
    const db = database(checkout, 'events.db', EVENTS);
    const original = (): { ms: number; value: number } => {
      const started = performance.now();
      const conn = new DatabaseSync(join(checkout, db), { readOnly: true });
      const row = conn.prepare(QUERY).get() as { pairs: number };
      conn.close();
      return { ms: performance.now() - started, value: row.pairs };
    };
    const value = original().value;
    const spec = numbersSpec([{ where: 'dashboard: distinct account and amount pairs', stated: value.toLocaleString('en-US'), query: { database: db, sql: QUERY } }]);
    const fill = (await numbers()).numbersFill();

    const query: number[] = [];
    const rerun: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      query.push(original().ms);
      const started = performance.now();
      const r = await fill.run(spec, context(checkout));
      rerun.push(performance.now() - started);
      expect(r.outcome, shown(r)).toBe('passed');
    }
    const fastest = (ms: number[]): number => Math.min(...ms);
    const ms = (xs: number[]): string => xs.map((x) => x.toFixed(1)).join(', ');
    expect(fastest(rerun), `re-run ${ms(rerun)} ms against the query's ${ms(query)} ms`).toBeLessThanOrEqual(2 * fastest(query));
  });
});

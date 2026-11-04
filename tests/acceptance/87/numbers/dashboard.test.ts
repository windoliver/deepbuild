// A dashboard number three times too high fails with both values shown: the numbers check re-runs the query the
// dashboard's number cites and finds 1500 where the dashboard states 4,500; through the core's verdict, FAIL. The
// dashboard stating what its query returns passes.
import { describe, expect, it } from 'vitest';
import { database, judge, numbersSpec, runNumbers, shown, tempDir, writtenEither } from './helpers.ts';

const ORDERS = [
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, placed TEXT NOT NULL, amount INTEGER NOT NULL);',
  "INSERT INTO orders (id, placed, amount) VALUES (1, '2026-10-01', 100), (2, '2026-10-09', 250), (3, '2026-10-17', 400), (4, '2026-10-30', 750), (5, '2026-11-02', 90);",
].join(' ');
const REVENUE = "SELECT SUM(amount) AS revenue FROM orders WHERE placed BETWEEN '2026-10-01' AND '2026-10-31'";

describe('a dashboard number three times too high fails with both values shown', () => {
  it('the dashboard stating October revenue as 4,500 where its query returns 1500 fails at the assertion showing both; stating 1,500 passes', async () => {
    const checkout = tempDir();
    const db = database(checkout, 'shop.db', ORDERS);
    const stated = (value: string) => numbersSpec([{ where: 'dashboard: revenue, October 2026', stated: value, query: { database: db, sql: REVENUE } }]);

    const wrong = await runNumbers(stated('4,500'), checkout);
    expect(wrong.outcome, shown(wrong)).toBe('failed');
    const both = wrong.failures.find((f) => f.assertion && writtenEither(4500).test(f.message) && writtenEither(1500).test(f.message));
    expect(both, `a failure at the check's assertion shows both 4,500 and 1500 (${shown(wrong)})`).toBeDefined();
    expect(judge(wrong).outcome).toBe('FAIL');

    const right = await runNumbers(stated('1,500'), checkout);
    expect(right.outcome, shown(right)).toBe('passed');
    expect(judge(right).outcome).toBe('PASS');
  });
});

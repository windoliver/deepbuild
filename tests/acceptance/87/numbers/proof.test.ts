// The Proof line: a numbers check against a seeded wrong total. The daily rollup is seeded with a wrong total, 1,850;
// the dashboard's query reads it faithfully and the claim states it, so only the independent recount, from the raw
// orders, finds 1500. The check fails showing both values; FAIL. The rollup holding 1,500 passes; PASS.
import { describe, expect, it } from 'vitest';
import { database, judge, numbersSpec, runNumbers, shown, tempDir, writtenEither } from './helpers.ts';

const shop = (rollup: number): string => [
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, day TEXT NOT NULL, amount INTEGER NOT NULL);',
  "INSERT INTO orders (id, day, amount) VALUES (1, '2026-10-31', 100), (2, '2026-10-31', 250), (3, '2026-10-31', 400), (4, '2026-10-31', 750), (5, '2026-10-30', 60);",
  'CREATE TABLE daily_totals (day TEXT PRIMARY KEY, total INTEGER NOT NULL);',
  `INSERT INTO daily_totals (day, total) VALUES ('2026-10-30', 60), ('2026-10-31', ${rollup});`,
].join(' ');

describe('Proof: a numbers check against a seeded wrong total', () => {
  it('a rollup seeded with 1,850 where the raw orders sum to 1500 fails at the assertion showing both; the rollup holding 1,500 passes', async () => {
    const check = async (rollup: number) => {
      const checkout = tempDir();
      const db = database(checkout, 'shop.db', shop(rollup));
      const spec = numbersSpec([{
        where: 'dashboard: sales on 2026-10-31',
        stated: rollup.toLocaleString('en-US'),
        query: { database: db, sql: "SELECT total FROM daily_totals WHERE day = '2026-10-31'" },
        recount: { database: db, sql: "SELECT SUM(amount) AS total FROM orders WHERE day = '2026-10-31'" },
      }]);
      return await runNumbers(spec, checkout);
    };

    const wrong = await check(1850);
    expect(wrong.outcome, shown(wrong)).toBe('failed');
    const both = wrong.failures.find((f) => f.assertion && writtenEither(1850).test(f.message) && writtenEither(1500).test(f.message));
    expect(both, `a failure at the check's assertion shows both 1,850 and the recount's 1500 (${shown(wrong)})`).toBeDefined();
    expect(judge(wrong).outcome).toBe('FAIL');

    const right = await check(1500);
    expect(right.outcome, shown(right)).toBe('passed');
    expect(judge(right).outcome).toBe('PASS');
  });
});

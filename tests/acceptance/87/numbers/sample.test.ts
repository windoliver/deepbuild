// A scoring term, filter, input or data source the change adds also runs on a read-only sample of real data, and one
// that changes no result there fails, showing the sample. On a sample of 200 orders with no test orders among them, a
// filter dropping test orders changes nothing: FAIL, naming the filter and the sample. A filter dropping refunded
// orders changes the total there: PASS. The sample is read-only, and left byte for byte as it was.
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AddedTerm } from '../../../../packages/checks-numbers/src/index.ts';
import { database, judge, numbersSpec, runNumbers, sha256, shown, tempDir } from './helpers.ts';

const SAMPLE = 'samples/orders-2026-10.db';
/** 200 orders: every seventh refunded, the rest paid, none a test order. */
const REAL = [
  "CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'test')), amount INTEGER NOT NULL);",
  "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200) INSERT INTO orders (id, status, amount) SELECT i, CASE WHEN i % 7 = 0 THEN 'refunded' ELSE 'paid' END, 20 + (i * 37) % 180 FROM n;",
].join(' ');
const filter = (term: string): AddedTerm => ({
  kind: 'filter', term,
  with: `SELECT SUM(amount) AS revenue FROM orders WHERE ${term}`,
  without: 'SELECT SUM(amount) AS revenue FROM orders',
  sample: SAMPLE,
});

describe('a term the change adds runs on a read-only sample of real data, and one that changes no result there fails, showing the sample', () => {
  it("the filter status <> 'test' changes nothing on a sample with no test orders and fails, naming it and the sample; status <> 'refunded' passes", async () => {
    const checkout = tempDir();
    database(checkout, SAMPLE, REAL);
    chmodSync(join(checkout, SAMPLE), 0o444);
    const before = sha256(readFileSync(join(checkout, SAMPLE)));

    const idle = "status <> 'test'";
    const useless = await runNumbers(numbersSpec([], [filter(idle)]), checkout);
    expect(useless.outcome, shown(useless)).toBe('failed');
    const named = useless.failures.find((f) => f.assertion && f.message.includes(idle) && f.message.includes(SAMPLE));
    expect(named, `a failure at the check's assertion names ${idle} and shows the sample ${SAMPLE} (${shown(useless)})`).toBeDefined();
    expect(judge(useless).outcome).toBe('FAIL');

    const useful = await runNumbers(numbersSpec([], [filter("status <> 'refunded'")]), checkout);
    expect(useful.outcome, shown(useful)).toBe('passed');
    expect(judge(useful).outcome).toBe('PASS');

    expect(sha256(readFileSync(join(checkout, SAMPLE))), 'the sample is left as it was').toBe(before);
  });
});

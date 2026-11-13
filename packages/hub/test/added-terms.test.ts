// The terms a claim's diff adds to a query (#1863), read from the merge base's text and the claim's: each one the
// change adds, by kind and with its query with it and without it, and none where the change rewrites what was there or
// the text isn't one statement that reads. A wrong reading either hands the numbers check a term the diff never added,
// which fails a claim on nothing, or none for one it did, which passes a filter that changes nothing.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addedTerms, readsOnly } from '../src/terms.js';

const BASE = 'SELECT id, total FROM orders WHERE total > 0 ORDER BY id\n';
const sample = 'data/orders-sample.db';

describe('a term a claim adds to a query', () => {
  it('is a filter where it joins the WHERE clause, its query without it the base query again', () => {
    const after = "SELECT id, total FROM orders WHERE total > 0 AND status <> 'void' ORDER BY id\n";
    const [t, ...rest] = addedTerms(BASE, after, sample);
    expect(rest).toEqual([]);
    expect(t).toMatchObject({ kind: 'filter', term: "status <> 'void'", with: after, sample });
    expect(t!.without.replace(/\s+/g, ' ').trim()).toBe(BASE.trim());
  });
  it('is a filter where it opens the WHERE clause, a data source where it joins a table, a scoring term where it orders', () => {
    const base = 'SELECT id FROM orders\n';
    expect(addedTerms(base, "SELECT id FROM orders WHERE status = 'paid'\n", sample).map((t) => [t.kind, t.term])).toEqual([['filter', "status = 'paid'"]]);
    expect(addedTerms(base, 'SELECT id FROM orders JOIN refunds ON refunds.order_id = orders.id\n', sample).map((t) => t.kind)).toEqual(['data source']);
    expect(addedTerms('SELECT id FROM orders ORDER BY id\n', 'SELECT id FROM orders ORDER BY total DESC, id\n', sample).map((t) => [t.kind, t.term])).toEqual([['scoring term', 'total DESC']]);
    expect(addedTerms(base, 'SELECT id, total FROM orders\n', sample).map((t) => [t.kind, t.term])).toEqual([['input', 'total']]);
  });
  it('is none where the change rewrites or removes what the base wrote', () => {
    expect(addedTerms(BASE, 'SELECT id, total FROM orders WHERE total > 10 ORDER BY id\n', sample)).toEqual([]);
    expect(addedTerms(BASE, 'SELECT id FROM orders WHERE total > 0 ORDER BY id\n', sample)).toEqual([]);
    expect(addedTerms(BASE, BASE.toLowerCase(), sample)).toEqual([]);
  });
  it('is none where either side is no one statement that reads: a second statement, a parameter, a write', () => {
    expect(addedTerms(BASE, "SELECT id, total FROM orders WHERE total > 0 AND status <> 'void' ORDER BY id; DELETE FROM orders\n", sample)).toEqual([]);
    expect(addedTerms(BASE, 'SELECT id, total FROM orders WHERE total > 0 AND status <> ? ORDER BY id\n', sample)).toEqual([]);
    expect(readsOnly('DELETE FROM orders')).toBe(false);
    expect(readsOnly('SELECT 1; SELECT 2')).toBe(false);
    expect(readsOnly('SELECT * FROM t WHERE x = :x')).toBe(false);
    expect(readsOnly('WITH a AS (SELECT 1) SELECT * FROM a;')).toBe(true);
  });
  it('reads any condition added at the end of the WHERE clause as that filter, its query without it the base query', () => {
    const word = fc.stringMatching(/^[a-z][a-z_]{0,7}$/).filter((w) => !['and', 'or', 'not', 'is', 'in', 'like', 'order', 'by', 'between', 'null', 'as', 'on', 'from', 'where', 'join', 'select', 'with', 'group', 'having', 'limit', 'offset', 'union', 'all', 'distinct', 'asc', 'desc', 'exists', 'case', 'when', 'then', 'else', 'end', 'using', 'natural', 'inner', 'left', 'right', 'outer', 'cross', 'full'].includes(w));
    const value = fc.oneof(fc.integer({ min: 0, max: 10_000 }).map(String), fc.stringMatching(/^[a-z]{1,8}$/).map((s) => `'${s}'`));
    fc.assert(fc.property(word, fc.constantFrom('=', '<>', '<', '>', '<=', '>='), value, (column, op, v) => {
      const condition = `${column} ${op} ${v}`;
      const terms = addedTerms(BASE, BASE.replace('total > 0', `total > 0 AND ${condition}`), sample);
      expect(terms.map((t) => [t.kind, t.term])).toEqual([['filter', condition]]);
      expect(terms[0]!.without.replace(/\s+/g, ' ').trim()).toBe(BASE.trim());
    }), { numRuns: 200 });
  });
});

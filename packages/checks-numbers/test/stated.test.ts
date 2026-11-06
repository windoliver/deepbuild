// A stated number is read as people write it, digits with commas and a decimal point: text that states no number
// (empty, blank, hex, an exponent) is no number, so the check stops on it, never passes. JavaScript's Number() reads
// "" and " " as 0 and "0x10" as 16, so those once passed against a query returning 0 or 16. #87 states only decimals.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { numbersFill, type NumbersSpec } from '../src/index.js';

let checkout: string;
beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'deep-numbers-'));
  const db = new DatabaseSync(join(checkout, 'shop.db'));
  db.exec('CREATE TABLE t (x INTEGER)');
  db.close();
});
afterEach(() => rmSync(checkout, { recursive: true, force: true }));

const run = (stated: string, value: string) => {
  const spec: NumbersSpec = { kind: 'numbers', runner: 'sqlite', inputs: ['shop.db'], depth: 'unit', oracle: 'code', contract: null, numbers: [{ where: 'dashboard: revenue', stated, query: { database: 'shop.db', sql: `SELECT ${value}` } }], added: [] };
  return numbersFill().run(spec, { checkout, deadline: 10_000, now: () => Date.now() });
};

describe('a stated number', () => {
  for (const [stated, value] of [['', '0'], [' ', '0'], ['0x10', '16'], ['1e3', '1000']] as const) {
    it(`is no number as ${JSON.stringify(stated)}, so the run stops before its assertion`, async () => {
      const r = await run(stated, value);
      expect(r.outcome, JSON.stringify(r)).toBe('failed');
      expect(r.failures.some((f) => !f.assertion && f.message.includes("isn't a number")), JSON.stringify(r.failures)).toBe(true);
    });
  }
  for (const [stated, value] of [['1,500', '1500'], ['-3.25', '-3.25'], ['1.8', '1.79'], ['0', '0']] as const) {
    it(`holds as ${stated} for ${value}`, async () => {
      expect((await run(stated, value)).outcome).toBe('passed');
    });
  }
});

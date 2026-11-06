// A claim cites a source only when what it cites is there: a citation of a file that doesn't exist, or a pointer that
// names nothing in it, cites nothing, so the claim fails at the check's assertion, numbers or no numbers. #68's
// fixtures cite only sources that exist.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workFill, type DocumentSpec } from '../src/index.js';

let checkout: string;
beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'deep-doc-'));
  mkdirSync(join(checkout, 'sources'));
  writeFileSync(join(checkout, 'sources/q3.json'), JSON.stringify({ revenue: { west: 1240 } }));
});
afterEach(() => rmSync(checkout, { recursive: true, force: true }));

const run = (line: string) => {
  writeFileSync(join(checkout, 'report.md'), `# Third quarter\n\n${line}\n`);
  const spec: DocumentSpec = { kind: 'document', runner: 'markdown', inputs: [], depth: 'unit', oracle: 'code', contract: null, document: 'report.md' };
  return workFill('document').run(spec, { checkout, deadline: 10_000, now: () => Date.now() });
};

describe('a claim whose citation names nothing', () => {
  for (const [line, names] of [
    ['Sales grew fast [source](sources/missing.json#/revenue).', 'sources/missing.json'],
    ['Sales grew fast [source](sources/q3.json#/revenue/east).', 'sources/q3.json#/revenue/east'],
  ] as const) {
    it(`fails at the check's assertion: ${line}`, async () => {
      const r = await run(line);
      expect(r.outcome, JSON.stringify(r)).toBe('failed');
      expect(r.failures.some((f) => f.assertion && f.message.includes(names)), JSON.stringify(r.failures)).toBe(true);
    });
  }
  it('passes when what it cites is there', async () => {
    expect((await run('Sales grew fast [source](sources/q3.json#/revenue/west).')).outcome).toBe('passed');
  });
});

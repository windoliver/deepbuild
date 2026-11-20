// #2924 AC8: docs/parallel-proof.md sections 6 and 13 each state that test grants past the first are decided by
// memory and load, up to the ceiling, with 24 GiB per run and 5 minutes of settling; their tables keep 6 (Spark) and
// 2 (Mac) as the ceiling. The wording is the writer's, so each fact is matched loosely.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from './helpers.mjs';

const doc = readFileSync(join(CHECKOUT, 'docs/parallel-proof.md'), 'utf8');
const section = (n) => {
  const start = doc.search(new RegExp(`^## ${n}\\. `, 'm'));
  assert.ok(start >= 0, `docs/parallel-proof.md has no section ${n}`);
  const rest = doc.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
};
// The table row whose first cell is `label`, keyed by its table's header.
function row(text, label) {
  const lines = text.split('\n').filter((line) => line.startsWith('|'));
  const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());
  const found = lines.find((line) => cells(line)[0] === label);
  assert.ok(found, `no table row "${label}"`);
  let at = lines.indexOf(found);
  while (at > 0 && !/^\|[-:| ]+\|$/.test(lines[at])) at--;
  return Object.fromEntries(cells(lines[at - 1]).map((name, k) => [name, cells(found)[k]]));
}

const FACTS = {
  'the first test grant': /\bfirst\b/i,
  'memory': /\bmemory\b/i,
  'load': /\bload\b/i,
  'the ceiling': /\bceiling\b|\bcap\b/i,
  '24 GiB per run': /\b24\s?(GiB|GB|G)\b/,
  'the 5-minute settling': /\b(5|five)[\s-]?min(ute)?s?\b[^.]*settl|settl[^.]*\b(5|five)[\s-]?min/i,
};

for (const [n, label] of [[6, 'test'], [13, 'test grants']]) {
  test(`#2924.AC8 section ${n} states that test grants past the first are decided by memory and load up to the ceiling, with 24 GiB a run and 5 min settling`, () => {
    const text = section(n);
    const missing = Object.entries(FACTS).filter(([, pattern]) => !pattern.test(text)).map(([fact]) => fact);
    assert.deepEqual(missing, [], `section ${n} doesn't state: ${missing.join(', ')}`);
  });
  test(`#2924.AC8 section ${n}'s table keeps 6 (Spark) and 2 (Mac) for test`, () => {
    const cells = row(section(n), label);
    assert.equal(cells.Spark, '6', JSON.stringify(cells));
    assert.equal(cells.Mac, '2', JSON.stringify(cells));
  });
}

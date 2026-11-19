// #2833 AC2: the design states 6 for the Spark's test class, in docs/parallel-proof.md section 6's class table and
// section 13's capacity table, and the Mac's stays 2.
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
// The table row whose first cell is `label`, as trimmed cells, with the header row's columns as keys.
function row(text, label) {
  const lines = text.split('\n').filter((line) => line.startsWith('|'));
  const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());
  const found = lines.find((line) => cells(line)[0] === label);
  assert.ok(found, `no table row "${label}" in:\n${lines.join('\n')}`);
  // Its table's header is the line just above the nearest separator line (|---|---|) before it.
  let at = lines.indexOf(found);
  while (at > 0 && !/^\|[-:| ]+\|$/.test(lines[at])) at--;
  assert.ok(at > 0, `no table header above "${label}"`);
  const header = cells(lines[at - 1]);
  return Object.fromEntries(header.map((name, k) => [name, cells(found)[k]]));
}

test('#2833.AC2 section 6\'s class table gives the Spark 6 test slots and the Mac 2', () => {
  const test6 = row(section(6), 'test');
  assert.equal(test6.Spark, '6', `section 6's test row: ${JSON.stringify(test6)}`);
  assert.equal(test6.Mac, '2', `section 6's test row: ${JSON.stringify(test6)}`);
});

test('#2833.AC2 section 13\'s capacity table gives the Spark 6 test grants and the Mac 2', () => {
  const grants = row(section(13), 'test grants');
  assert.equal(grants.Spark, '6', `section 13's test grants row: ${JSON.stringify(grants)}`);
  assert.equal(grants.Mac, '2', `section 13's test grants row: ${JSON.stringify(grants)}`);
});

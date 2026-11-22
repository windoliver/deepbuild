// #2980 AC4: docs/parallel-proof.md sections 6 and 13 each state that the Mac reads available memory from
// kern.memorystatus_level and budgets 8 GiB a run, and that the Spark budgets 24 GiB a run. The wording is the
// writer's, so each fact is a sentence that names the machine and the fact, matched loosely.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from '../2924/helpers.mjs';

const doc = readFileSync(join(CHECKOUT, 'docs/parallel-proof.md'), 'utf8');
function section(n) {
  const start = doc.search(new RegExp(`^## ${n}\\. `, 'm'));
  assert.ok(start >= 0, `docs/parallel-proof.md has no section ${n}`);
  const rest = doc.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}
// Sentences end at a full stop or semicolon followed by space, or at a line break; a dot inside a name doesn't split one.
const sentences = (text) => text.split(/(?<=[.;])\s+|\n+/);

const MAC = /\bMac\b|\bdarwin\b|\bmacOS\b/i;
const SPARK = /\bSpark\b|\bLinux\b/;
const FACTS = [
  ['the Mac reads available memory from kern.memorystatus_level', MAC, /kern\.memorystatus_level/],
  ['the Mac budgets 8 GiB a run', MAC, /(?<![\d.])8\s?(GiB|GB|G)\b/],
  ['the Spark budgets 24 GiB a run', SPARK, /(?<![\d.])24\s?(GiB|GB|G)\b/],
];

for (const n of [6, 13]) {
  for (const [fact, machine, pattern] of FACTS) {
    test(`#2980.AC4 section ${n} states that ${fact}`, () => {
      const found = sentences(section(n)).some((s) => machine.test(s) && pattern.test(s));
      assert.ok(found, `no sentence of section ${n} names ${machine} together with ${pattern}`);
    });
  }
}

// #2980 criterion 4: docs/parallel-proof.md sections 6 and 13 each state that the Mac reads available memory from
// kern.memorystatus_level and budgets 8 GiB a run, and that the Spark budgets 24 GiB a run. The wording is the
// writer's, so each fact is matched loosely: the sysctl's name anywhere in the section, and a sentence (or table row)
// that names the machine beside its amount. A section that only refers to the other fails.
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
// Sentences and lines: split at a line break, or after . ; : before a capital, a backtick or a bracket, so
// `kern.memorystatus_level` and `os.freemem()` stay whole.
const sentences = (text) => text.split(/\n|(?<=[.;:])\s+(?=[A-Z`(*])/).filter((s) => s.trim());
const amount = (n) => new RegExp(`\\b${n}\\s?(GiB|GB|G)\\b`);

const FACTS = {
  'the Mac reads kern.memorystatus_level': (text) => /kern\.memorystatus_level/.test(text),
  'the Mac budgets 8 GiB a run': (text) => sentences(text).some((s) => /\b(Mac|darwin|macOS)\b/i.test(s) && amount(8).test(s)),
  'the Spark budgets 24 GiB a run': (text) => sentences(text).some((s) => /\b(Spark|Linux)\b/i.test(s) && amount(24).test(s)),
};

for (const n of [6, 13]) {
  test(`#2980.4c98823b section ${n} states the Mac reads kern.memorystatus_level and budgets 8 GiB a run, and the Spark budgets 24 GiB a run`, () => {
    const text = section(n);
    const missing = Object.entries(FACTS).filter(([, holds]) => !holds(text)).map(([fact]) => fact);
    assert.deepEqual(missing, [], `section ${n} of docs/parallel-proof.md doesn't state: ${missing.join('; ')}`);
  });
}

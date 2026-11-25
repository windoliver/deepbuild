// #3238 AC6: docs/parallel-proof.md section 6 states the rule: `scripts/lease` never runs a command bare; it holds a
// throttle grant, passing through on an ancestor's. The wording is the writer's, so each fact is matched loosely, in
// the one bullet or paragraph of section 6 that names `scripts/lease` and states the rule.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC6, CHECKOUT } from './helpers.mjs';

const doc = readFileSync(join(CHECKOUT, 'docs/parallel-proof.md'), 'utf8');
function section(n) {
  const start = doc.search(new RegExp(`^## ${n}\\. `, 'm'));
  assert.ok(start >= 0, `docs/parallel-proof.md has no section ${n}`);
  const rest = doc.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

const FACTS = {
  'it never runs a command bare': (text) => /\bnever\b[\s\S]{0,120}?\b(?:bare|unthrottled|uncounted)\b|\bnever\b[\s\S]{0,120}?\b(?:without|outside)\b[\s\S]{0,40}?\bgrant|\balways\b[\s\S]{0,120}?\bgrant/i.test(text),
  'it holds a throttle grant': (text) => /\bthrottle\b[\s\S]{0,60}?\bgrant|\bgrant\b[\s\S]{0,40}?\bthrottle\b|\bbuild`? grant/i.test(text),
  "it passes through on an ancestor's grant": (text) => /\bpass(?:es|ed|ing)?[\s-]?through\b|\bpassthrough\b/i.test(text) && /\b(?:ancestor|inherited|caller|parent)/i.test(text),
};

test(`${AC6} docs/parallel-proof.md section 6 states that scripts/lease never runs a command bare: it holds a throttle grant, passing through on an ancestor's`, () => {
  const blocks = section(6).split(/\n(?=- )|\n\s*\n/).filter((block) => block.includes('scripts/lease'));
  assert.ok(blocks.length, 'section 6 never names scripts/lease');
  const missing = (block) => Object.entries(FACTS).filter(([, holds]) => !holds(block)).map(([fact]) => fact);
  const best = blocks.map((block) => ({ block, missing: missing(block) })).sort((a, b) => a.missing.length - b.missing.length)[0];
  assert.deepEqual(best.missing, [], `section 6's text on scripts/lease doesn't state: ${best.missing.join('; ')}\n${best.block}`);
});

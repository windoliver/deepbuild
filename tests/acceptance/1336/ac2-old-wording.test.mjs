// Criterion 2, offline half: a search for Scale later's old not-proposed wording finds nothing in docs/ or README.md.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT } from './helpers.mjs';

const OLD = "different people's agents writing one record";
// Case, curly apostrophes and line wrapping don't hide it.
const normal = (text) => text.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const TEXT = /\.(md|mdx|markdown|txt|html?|json|ya?ml)$/i;

test(`#1336.94a30ea1 criterion 2: a search of docs/ and README.md for the old wording "${OLD}" finds nothing`, () => {
  const files = [...walk(join(CHECKOUT, 'docs')).filter((f) => TEXT.test(f)), join(CHECKOUT, 'README.md')].filter(existsSync);
  assert.ok(files.some((f) => f.endsWith('technical-design.md')), 'the search found no docs/technical-design.md to read');
  const hits = files.filter((f) => normal(readFileSync(f, 'utf8')).includes(OLD)).map((f) => relative(CHECKOUT, f));
  assert.deepEqual(hits, [], `the old not-proposed wording is still in ${hits.join(', ')}`);
});

// Criterion 6 of #3402: the lanes run the redraft in the originals' place, and scripts/known-failures.json gains no
// entry for #1352. The lists are read through the public entry, scripts/lanes.mjs, in a child; the entries expected
// are in README.md, AC6.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, ORIGINAL, REDRAFT, laneLists, listed } from './helpers.mjs';

// The first-draft files whose tests fail at the finder and the Decided count, each replaced by the redraft folder.
const REPLACED = ['ac1-section', 'ac3-agent-routes', 'ac5-taste-call'].map((name) => `${ORIGINAL}${name}.test.mjs`);
// The first-draft file that stays in the lanes as it is: its three tests need no redraft.
const KEPT = `${ORIGINAL}ac2-privacy-threats.test.mjs`;
// The lists that take a file out of an ordinary run (scripts/affected.mjs, `plan`): by hand, a lane of its own, only
// with --timed, only with --slow unless changed, or the alone block. On the base the first-draft files are in none.
const APART = ['byHand', 'ownLane', 'timed', 'slow', 'alone', 'exclusive'];
const tags = (path) => [...new Set(readFileSync(join(CHECKOUT, path), 'utf8').match(/#1352\.[0-9a-f]{8}/g) ?? [])].sort();

test('#3402.76e0cb78 the lanes run the redraft in the originals\' place: each of the three first-draft files maps to the redraft folder and runs by hand only; the redraft\'s files and the threats file are in none of the lists that take a file out of an ordinary run, as the first-draft files were in none; and the redraft holds every tag of the files it replaces', () => {
  const lists = laneLists();
  assert.equal(lists.error, undefined, lists.error);
  const redraft = readdirSync(join(CHECKOUT, REDRAFT)).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `${REDRAFT}${name}`);
  const within = (path) => APART.filter((name) => !Array.isArray(lists[name]) || listed(lists[name], path));
  assert.deepEqual({
    redrafted: Object.fromEntries(REPLACED.map((path) => [path, lists.redrafted?.[path] ?? null])),
    lists: Object.fromEntries([...REPLACED, KEPT, ...redraft].map((path) => [path, within(path)])),
  }, {
    redrafted: Object.fromEntries(REPLACED.map((path) => [path, REDRAFT])),
    lists: Object.fromEntries([...REPLACED.map((path) => [path, ['byHand']]), [KEPT, []], ...redraft.map((path) => [path, []])]),
  }, 'scripts/lanes.mjs does not run the redraft in the originals\' place');
  assert.deepEqual([...new Set(redraft.flatMap(tags))].sort(), [...new Set(REPLACED.flatMap(tags))].sort(), 'the redraft\'s test files do not hold the tags of the files they replace');
});

test('#3402.76e0cb78 scripts/known-failures.json has no entry for #1352: no string in it, key or value at any depth, names a test under tests/acceptance/1352 or its redraft, or a #1352 criterion', () => {
  const known = JSON.parse(readFileSync(join(CHECKOUT, 'scripts/known-failures.json'), 'utf8'));
  assert.ok(known.failures && typeof known.failures === 'object', 'scripts/known-failures.json has no "failures" to read');
  // Every string: an object's keys, and each value down to the leaves, list items included (`skips` and `timing`).
  const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? [...(Array.isArray(value) ? [] : Object.keys(value)), ...Object.values(value).flatMap(strings)] : []);
  const all = strings(known);
  assert.ok(all.length > Object.keys(known.failures).length, 'no string of scripts/known-failures.json was read');
  assert.deepEqual(all.filter((text) => /tests\/acceptance\/1352\b|#1352\.[0-9a-f]{8}/.test(text)), []);
});

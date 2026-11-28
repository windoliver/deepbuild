import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { REPO } from './helpers.mjs';

const FIRST_DRAFT = 'tests/acceptance/2696/base.test.mjs';
const REDRAFT = 'tests/acceptance/2696-redraft-3706/';
const covers = (entry, path) => entry === path || (entry.endsWith('/') && path.startsWith(entry));
const testFilesOf = (folder) => readdirSync(join(REPO, folder)).filter((name) => /\.test\.(?:mjs|js|ts)$/.test(name)).sort().map((name) => `${folder}${name}`);

test('#3706.75c61bdf the first draft runs by hand with a redrafted entry naming this folder, and the first draft folder\'s other files and this folder\'s files run in the alone block', async () => {
  const { alone, byHand, redrafted } = await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href);
  const where = (path) => (byHand.some((entry) => covers(entry, path)) ? 'by hand' : alone.some((entry) => covers(entry, path)) ? 'alone' : 'elsewhere');
  const others = testFilesOf('tests/acceptance/2696/').filter((path) => path !== FIRST_DRAFT);
  const mine = testFilesOf(REDRAFT);
  if (!others.length || !mine.length) throw Error(`BLOCKED: no test file beside the first draft (${others.length}) or in this folder (${mine.length})`);
  const seen = {
    redrafted: redrafted[FIRST_DRAFT] ?? null,
    [FIRST_DRAFT]: where(FIRST_DRAFT),
    ...Object.fromEntries([...others, ...mine].map((path) => [path, where(path)])),
  };
  const wanted = {
    redrafted: REDRAFT,
    [FIRST_DRAFT]: 'by hand',
    ...Object.fromEntries([...others, ...mine].map((path) => [path, 'alone'])),
  };
  assert.deepEqual(seen, wanted, 'scripts/lanes.mjs runs these files elsewhere than the redraft asks');
});

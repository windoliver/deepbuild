// #1824 AC3: a lock row whose URL names a branch or tag instead of a commit, or that has no size or no sha256, fails
// the lint, naming the row; a planted lane that fetches a file the lock doesn't list fails, naming the URL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { REPO, SCRIPT } from './helpers.mjs';
import { judgeLint, judgeUnlisted } from './judges.mjs';

test('#1824.f985f5df AC3: a row whose URL names a branch or a tag, or that has no size or no sha256, fails the lint, naming the row', async () => {
  assert.deepEqual(await judgeLint(SCRIPT), []);
  // "The lint" is a command of the lint lane, so the local preflight runs it.
  const { checks } = await import(pathToFileURL(join(REPO, 'scripts', 'lanes.mjs')).href);
  const commands = checks.find((lane) => lane.name === 'lint').commands.map((command) => command.slice(-2).join(' '));
  assert.ok(commands.includes('scripts/fetch-lock.mjs lint'), `the lint lane runs "scripts/fetch-lock.mjs lint"; it runs: ${commands.join(', ')}`);
});

test('#1824.f985f5df AC3: a planted lane that fetches a file the lock does not list fails, naming the URL', async () => {
  assert.deepEqual(await judgeUnlisted(SCRIPT), []);
});

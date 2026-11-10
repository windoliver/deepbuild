// #1824 AC3: a lock row whose URL names a branch or tag instead of a commit, or that has no size or no sha256, fails
// the lint, naming the row; a planted lane that fetches a file the lock doesn't list fails, naming the URL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { REPO, SCRIPT, twin } from './helpers.mjs';
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

test('#1824.f985f5df AC3: the planted lints that pass a moving ref or a row without its size or sha256, and the planted fetcher that fetches an unlisted file, each fail', async () => {
  assert.deepEqual(await judgeLint(twin('control')), [], 'the judge passes a right lint');
  assert.deepEqual(await judgeUnlisted(twin('control')), [], 'the judge passes a right fetcher');
  const all = (failures, patterns, what) => { for (const pattern of patterns) assert.ok(failures.some((line) => pattern.test(line)), `${what} ${pattern}: ${failures.join('\n') || 'the judge passed it'}`); };
  all(await judgeLint(twin('lint-any-ref')), [/names a branch \(planted\/branch\.js\) passes the lint/, /names a tag \(planted\/tag\.js\) passes the lint/], 'lint-any-ref');
  all(await judgeLint(twin('lint-fields-optional')), [/no size \(planted\/no-size\.js\) passes the lint/, /no sha256 \(planted\/no-sha256\.js\) passes the lint/], 'lint-fields-optional');
  all(await judgeUnlisted(twin('fetches-unlisted')), [/the planted lane that fetches http:\/\/127\.0\.0\.1:\d+\/fixture\/library\/[0-9a-f]{40}\/lib\/src\/unlisted\.js, which the lock doesn't list, passes/, /the fetcher requested http:\S+unlisted\.js, which the lock doesn't list/], 'fetches-unlisted');
});

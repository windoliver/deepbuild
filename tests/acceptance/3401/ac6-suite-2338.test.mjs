// Criterion 6 (#3401.4caee707): tests/acceptance/2338/ passes unchanged on the change. On the merge base its ceilings
// test fails, naming the section: the merge base's scripts, docs and suite, in a scratch repository of their own.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, CP, SECTION_KEY, SUITE_2338, TD, beforeCommit, changedSince, mergeBase, node, scratchOf } from './helpers.mjs';

const SUITE_TIMEOUT_MS = 10 * 60_000;
const CEILINGS_TEST = `${SUITE_2338}/ac4-ceilings.test.mjs`;
const failing = (run) => run.lines.filter((line) => /^\s*✖/.test(line)).join('\n') || '(no failing test named)';

test('#3401.4caee707 AC6: tests/acceptance/2338/ passes unchanged on the change; on the merge base its ceilings test fails, naming the section', (t) => {
  const files = readdirSync(join(CHECKOUT, SUITE_2338)).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `${SUITE_2338}/${name}`);
  assert.ok(files.includes(CEILINGS_TEST), `${SUITE_2338}/ holds no ac4-ceilings.test.mjs`);
  const run = node(CHECKOUT, ['--test', '--test-reporter=spec', ...files], { timeout: SUITE_TIMEOUT_MS });
  assert.equal(run.status, 0, `${SUITE_2338}/ doesn't pass on this checkout:\n${failing(run)}\n\n${run.output}`);

  const changed = changedSince(mergeBase(), SUITE_2338);
  assert.deepEqual(changed, [], `${SUITE_2338}/ isn't the merge base's: it passes unchanged, or not at all`);

  const before = beforeCommit();
  const base = scratchOf(t, before, ['scripts', TD, CP, SUITE_2338]);
  const failed = node(base.repo, ['--test', '--test-reporter=spec', CEILINGS_TEST], { env: base.env, timeout: SUITE_TIMEOUT_MS });
  assert.notEqual(failed.status, 0, `the ceilings test of ${SUITE_2338}/ passes on the merge base (${before.slice(0, 9)}):\n${failed.output}`);
  assert.ok(/✖ #2338\.1a6db6b6 AC4 on the commit under test/.test(failed.text), `the failing test on the merge base isn't the suite's first ceilings test:\n${failing(failed)}`);
  assert.ok(failed.text.includes(SECTION_KEY), `the ceilings test's failure on the merge base doesn't name ${SECTION_KEY}:\n${failed.output}`);
  t.diagnostic(`on the merge base ${before.slice(0, 9)}: ${failing(failed).split('\n')[0].trim()}`);
});

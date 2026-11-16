// #1830 AC2, on any machine: each Scope suite (and #268's and #968's) has its blind redraft, listed in
// scripts/lanes.mjs's `redrafted`, whose judgeLimit calls give loads; the lint lists the original's calls, which on the
// merge base give none, and the original no lane runs. The timing runs themselves are ac2-timing.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { checkout, copyScripts, lanes, lint, root, SCOPE, scriptFiles, TEST_FILE } from './helpers.ts';

test.each(SCOPE)('AC2 #1830.c69ecf39 $suite: the lint lists the original\'s judgeLimit calls, which give no loads, and its blind redraft, listed in redrafted, gives loads', async ({ suite, original, redraft }) => {
  expect(existsSync(join(root, redraft)), `${redraft} is missing: #${suite} has no blind redraft`).toBe(true);
  const files = scriptFiles(redraft);
  expect(files.filter((file) => TEST_FILE.test(file)), `${redraft} holds a test file`).not.toEqual([]);
  expect(files.some((file) => readFileSync(join(root, file), 'utf8').includes('judgeLimit')), `${redraft} calls judgeLimit, so it still judges its timing`).toBe(true);
  const { redrafted, byHand, listed } = await lanes();
  expect(redrafted, 'scripts/lanes.mjs exports redrafted').toBeTypeOf('object');

  // Before: the original alone, as the merge base has it.
  const at = checkout();
  expect(copyScripts(original, at), `${original} is in this checkout`).not.toEqual([]);
  const before = lint(at);
  expect(before.fails, `the lint lists #${suite}'s judgeLimit calls that give no loads:\n${before.output}`).not.toEqual([]);
  expect(before.result.status, before.output).toBe(1);
  for (const path of new Set(before.fails.map((fail) => fail.replace(/:\d+$/, '')))) {
    expect(original.endsWith('/') ? path.startsWith(original) : path === original, `${path} is under ${original}`).toBe(true);
    expect(redrafted[path], `redrafted maps ${path}, whose judgeLimit calls give no loads, to ${redraft}`).toBe(redraft);
    if (TEST_FILE.test(path)) expect(listed(byHand, path), `${path} is in byHand, so no lane runs it`).toBe(true);
  }

  // After: the redraft beside it.
  copyScripts(redraft, at);
  const after = lint(at);
  expect(after.fails, `with ${redraft} beside the original, the lint lists none:\n${after.output}`).toEqual([]);
  expect(after.passes, after.output).toBe(1);
  expect(after.result.status, after.output).toBe(0);
});

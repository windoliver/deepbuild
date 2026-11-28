// AC1 of #3622: the three trees are pinned at 0.1.19, every changed file has a row naming its issue, test and removal
// condition, and `check` passes against the pristine 0.1.19 releases. Needs the network for the releases, and
// node_modules for check to list the vitest suites the table's rows name.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AC, CRATES, VERSION, judgePins, judgeRows, redact, releases, repoRoot, runCheck, sameTree } from './common.mjs';

test(`AC1 ${AC[1]} vendor/gpui-fast, vendor/gpui-fast-apple and vendor/gpui-fast-macos are pinned at ${VERSION}`, () => {
  assert.deepEqual(judgePins(repoRoot), []);
});

test(`AC1 ${AC[1]} every vendored file that differs from its pristine ${VERSION} release has a row naming its issue, test and removal condition`, async () => {
  assert.deepEqual(judgeRows(repoRoot, await releases()), []);
});

test(`AC1 ${AC[1]} node scripts/vendor-rebase.mjs check passes, against the pristine ${VERSION} crates.io releases`, { timeout: 40 * 60_000 }, async () => {
  const rel = await releases(), problems = [];
  for (const crate of CRATES) if (!existsSync(join(repoRoot, 'vendor', crate, 'Cargo.toml'))) problems.push(`vendor/${crate} isn't there, so check reads no ${crate} tree`);
  if (!existsSync(join(repoRoot, 'node_modules/vitest/vitest.mjs'))) problems.push('INCONCLUSIVE: no node_modules/vitest here (npm ci), so check can\'t list the suites of the rows\' vitest tests');
  else {
    const run = runCheck(repoRoot);
    const refused = run.out.split('\n').filter((line) => /^(?:FAIL|BLOCKED|INCONCLUSIVE|INVALID)\b/.test(line));
    if (run.status !== 0 || refused.length) problems.push(`check exit ${run.status}:\n${redact(refused.slice(0, 20).join('\n'))}`);
    // What check compared with is its own cached copy of each release: it must be crates.io's bytes.
    for (const crate of CRATES) {
      const cached = join(homedir(), '.cache/deepbuild/vendor-releases', `${crate}-${VERSION}`);
      if (!existsSync(cached)) problems.push(`INCONCLUSIVE: check ran with no copy of ${crate} ${VERSION} in ~/.cache/deepbuild/vendor-releases, so what it compared with is unknown`);
      else problems.push(...sameTree(join(rel, `${crate}-${VERSION}`), cached).map((line) => `${crate} ${VERSION} as check read it: ${line}`));
    }
  }
  assert.deepEqual(problems, []);
});

// #1831 AC2: `node scripts/spine.mjs list` shows #13 at PR #1675's merge commit.
// Run: node --test tests/acceptance/1831/spine.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { AC2, root, show } from './helpers.mjs';

// `gh pr view 1675 --repo windoliver/deepbuild --json mergeCommit`, read on November 17, 2026.
const MERGE_OF_1675 = '96ee0fc4d7b8882145961ca215ad50c3e3d4a1ee';

test(`${AC2} \`node scripts/spine.mjs list\` shows #13 at ${MERGE_OF_1675}, the merge commit of PR #1675`, () => {
  const list = spawnSync(process.execPath, ['scripts/spine.mjs', 'list'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(list.status, 0, `scripts/spine.mjs list exits 0\n${show(list)}`);
  const rows = list.stdout.split('\n').filter((line) => /^#13 /.test(line));
  assert.deepEqual(rows, [`#13 ${MERGE_OF_1675}`], "scripts/spine.mjs: #13 has one row, at PR #1675's merge commit");
});

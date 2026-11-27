// Acceptance test for #3515, criterion 4, written blind from the issue at base b134dd38f. Surface: claimShards from
// scripts/shards.mjs in a child node with HOME a temporary folder. DEEP_TEST_SHARD_FLOOR is set past any disk's free
// space, so no shard has room and claimShards, asked for 3, claims none. The wording of the stderr line is the fix's:
// the test asks only that one line names the count asked and says the alone block runs unsharded in the worktree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { claim, repoA, scratch } from './helpers.mjs';

test('#3515.0d44293c claimShards asked for shards that claims none says so on stderr, naming the count and that the alone block runs unsharded in the worktree', (t) => {
  const { dir: root, home } = scratch(t);
  const a = join(root, 'a');
  repoA(a);
  const want = 3;
  const got = claim(home, a, want, { DEEP_TEST_SHARD_FLOOR: String(1e18) });
  assert.deepEqual(got.dirs, [], `no shard has room, so none is claimed: ${JSON.stringify(got.lines)}`);
  const stderr = got.stderr.split('\n').filter((line) => line.trim());
  const said = stderr.filter((line) => /unsharded|worktree/i.test(line));
  assert.equal(said.length, 1, `one stderr line says the alone block runs unsharded in the worktree; stderr was ${JSON.stringify(got.stderr)}`);
  assert.match(said[0], new RegExp(`\\b${want}\\b`), `the line names the ${want} shards asked for`);
});

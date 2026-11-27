// Acceptance tests for #3515, criteria 1 to 3, written blind from the issue at base b134dd38f. Surface: claimShards
// from scripts/shards.mjs in a child node with HOME a temporary folder and DEEP_TEST_SHARD_FLOOR=0. Shard 1 is made by
// repository A, so its alternates name only A's objects; then fresh clone B, whose HEAD and exact tree live only in its
// own objects, claims it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { alternates, claim, cloneB, escape, git, repoA, scratch, where } from './helpers.mjs';

/** Shard 1 made by A; returns its dir and its alternates as A left them. */
function madeByA(home, a) {
  repoA(a);
  const first = claim(home, a, 1);
  assert.equal(first.dirs.length, 1, `A claims one shard: ${JSON.stringify(first.lines)}`);
  const [dir] = first.dirs;
  assert.equal(dir, join(home, 'deepbuild-shards', '1'));
  assert.ok(first.lines.some((line) => line.startsWith(`SHARD 1 ${dir}: made, at tree `)), `A made shard 1: ${JSON.stringify(first.lines)}`);
  const lines = alternates(dir);
  assert.deepEqual(lines.map((line) => where(dir, line)), [realpathSync(join(a, '.git/objects'))], "the shard's alternates name only A's objects");
  return { dir, lines };
}

/** B claims the shard: the reused line at B's exact tree, and the shard's HEAD is B's. */
function claimedByB(home, b, dir, expected) {
  const got = claim(home, b, 1);
  const line = new RegExp(`^SHARD 1 ${escape(dir)}: reused, at tree ${expected.tree}(,|$)`);
  assert.ok(got.lines.some((text) => line.test(text)), `say got "SHARD 1 ${dir}: reused, at tree ${expected.tree}", got ${JSON.stringify(got.lines)}`);
  assert.deepEqual(got.dirs, [dir], 'claimShards returns the shard');
  assert.equal(git(dir, ['rev-parse', 'HEAD']).trim(), expected.head, "the shard's HEAD is B's HEAD");
  return got;
}

test('#3515.c4b78856 a shard another repository made is claimed from a fresh clone whose HEAD and tree live only in its own objects', (t) => {
  const { dir: root, home } = scratch(t);
  const { dir } = madeByA(home, join(root, 'a'));
  const b = join(root, 'b');
  const expected = cloneB(join(root, 'a'), b);
  claimedByB(home, b, dir, expected);
});

test('#3515.e9ecd1ad the same claim holds once the repository that made the shard is deleted', (t) => {
  const { dir: root, home } = scratch(t);
  const a = join(root, 'a');
  const { dir } = madeByA(home, a);
  const b = join(root, 'b');
  const expected = cloneB(a, b);
  rmSync(a, { recursive: true, force: true });
  claimedByB(home, b, dir, expected);
});

test('#3515.d46e20be the alternates keep every line they had, name the clone\'s objects once, and a second claim adds none', (t) => {
  const { dir: root, home } = scratch(t);
  const a = join(root, 'a');
  const { dir, lines: before } = madeByA(home, a);
  const b = join(root, 'b');
  cloneB(a, b);
  const objectsB = realpathSync(join(b, '.git/objects'));

  claim(home, b, 1);
  const after = alternates(dir);
  for (const line of before) assert.ok(after.includes(line), `alternates keep ${line}: ${JSON.stringify(after)}`);
  assert.equal(after.filter((line) => where(dir, line) === objectsB).length, 1, `alternates name B's objects (${objectsB}) once: ${JSON.stringify(after)}`);

  claim(home, b, 1);
  assert.deepEqual(alternates(dir), after, 'a second claim from B adds no line');
});

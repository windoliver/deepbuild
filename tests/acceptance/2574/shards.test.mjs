// #2574 AC1: shards are made on Linux. `claimShards(root, want, say)` of scripts/shards.mjs, called in a child process
// whose HOME is a temporary folder and whose DEEP_TEST_SHARD_FLOOR is 0, for a small git repository of the test's own:
// a committed file, an untracked file that isn't ignored, node_modules/, packages/p/dist/ and target/.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { claim, filesUnder, MAC, repository, sandbox, write } from './helpers.mjs';

const WANT = 2;
const COMMITTED = 'src/kept.txt', UNTRACKED = 'notes/new.txt', MODULE = 'node_modules/dep/index.js', BUILD = 'packages/p/dist/main.js';
const TARGET = ['target/debug/app', 'target/release/app', 'target/debug/deps/app-0123.d'];

function scene(t) {
  const box = sandbox(t);
  const root = repository(box, 'root', {
    '.gitignore': 'node_modules/\ndist/\ntarget/\n',
    [COMMITTED]: 'committed, as the worktree holds it\n',
    'package-lock.json': '{ "lockfileVersion": 3 }\n',
    'packages/p/package.json': '{ "name": "@deepbuild/p", "version": "0.0.0" }\n',
    'packages/p/src/main.ts': 'export const p = 1;\n',
  });
  // After the commit: the untracked file, and what .gitignore leaves out of the tree.
  write(root, {
    [UNTRACKED]: 'untracked, not ignored\n',
    [MODULE]: 'module.exports = "dep";\n',
    [BUILD]: 'export const p = 1; // built\n',
    ...Object.fromEntries(TARGET.map((path) => [path, `the worktree's ${path}\n`])),
  });
  return { box, root };
}

/** The claim's shards, `WANT` of them under the sandbox's HOME, each with its own line of `kind`; else it fails. */
function shardsOf(box, claimed, kind) {
  const unused = claimed.lines.filter((line) => line.includes('not used'));
  assert.deepEqual(unused, [], `say got ${unused.length} "not used" ${unused.length === 1 ? 'line' : 'lines'}\n${claimed.text}`);
  assert.equal(claimed.dirs.length, WANT, `claimShards(root, ${WANT}, say) returned ${claimed.dirs.length} shards, not ${WANT}\n${claimed.text}`);
  assert.equal(new Set(claimed.dirs).size, WANT, `the shards are not ${WANT} folders\n${claimed.text}`);
  for (const dir of claimed.dirs) {
    assert.ok(dir.startsWith(`${join(box.home, 'deepbuild-shards')}/`), `the shard ${dir} is not under the temporary HOME's deepbuild-shards/\n${claimed.text}`);
    const k = dir.split('/').at(-1);
    const line = claimed.lines.find((text) => text.startsWith(`SHARD ${k} ${dir}: `));
    assert.ok(line, `say got no "SHARD ${k} <dir>: ..." line for the shard at ${dir}\n${claimed.text}`);
    assert.match(line.slice(`SHARD ${k} ${dir}: `.length), kind, `shard ${k}'s line does not read as the criterion words it\n${claimed.text}`);
  }
  return claimed.dirs;
}
const MADE = /^made, at tree [0-9a-f]{40,64}, node_modules cloned$/, REUSED = /^reused, at tree [0-9a-f]{40,64}\b/;
const same = (root, dir, path, claimed) => {
  assert.ok(existsSync(join(dir, path)), `the shard ${dir} holds no ${path}\n${claimed.text}`);
  assert.deepEqual(readFileSync(join(dir, path)), readFileSync(join(root, path)), `the shard ${dir} holds ${path} with other bytes than the worktree's\n${claimed.text}`);
};

test('#2574 AC1 claimShards returns `want` shards, and say gets "SHARD <k> <dir>: made, at tree <hash>, node_modules cloned" for each, with no "not used" line', (t) => {
  const { box, root } = scene(t);
  const claimed = claim(box, root, WANT);
  shardsOf(box, claimed, MADE);
  assert.equal(claimed.lines.length, WANT, `say got ${claimed.lines.length} lines for ${WANT} shards\n${claimed.text}`);
});

test('#2574 AC1 each shard\'s folder holds the committed and the untracked file with the worktree\'s bytes, node_modules/ and packages/<p>/dist/', (t) => {
  const { box, root } = scene(t);
  const claimed = claim(box, root, WANT);
  for (const dir of shardsOf(box, claimed, MADE)) for (const path of [COMMITTED, UNTRACKED, MODULE, BUILD]) same(root, dir, path, claimed);
});

test('#2574 AC1 a second claim of the same shard after an edit in root says "reused" and holds the edited bytes', (t) => {
  const { box, root } = scene(t);
  const first = shardsOf(box, claim(box, root, WANT), MADE);
  writeFileSync(join(root, COMMITTED), 'committed, then edited in the worktree and not committed\n');
  writeFileSync(join(root, UNTRACKED), 'untracked, then edited\n');
  const claimed = claim(box, root, WANT);
  const second = shardsOf(box, claimed, REUSED);
  assert.deepEqual([...second].sort(), [...first].sort(), `the second claim took other shards than the first\n${claimed.text}`);
  for (const dir of second) for (const path of [COMMITTED, UNTRACKED, MODULE, BUILD]) same(root, dir, path, claimed);
});

test('#2574 AC1 off macOS a new shard holds no target/ of the worktree\'s', { skip: MAC && 'the criterion is for a machine without copy-on-write clones: on macOS the clone stays cp -c and a new shard holds target/ (the next test)' }, (t) => {
  const { box, root } = scene(t);
  const claimed = claim(box, root, WANT);
  for (const dir of shardsOf(box, claimed, MADE)) {
    const copied = filesUnder(join(dir, 'target'));
    assert.deepEqual(copied, [], `the new shard ${dir} holds ${copied.length} files of the worktree's target/\n${claimed.text}`);
  }
});

test('#2574 AC1 on macOS the clone stays: a new shard holds the worktree\'s target/', { skip: !MAC && 'macOS only: off macOS a new shard holds no target/ of the worktree\'s (the test before)' }, (t) => {
  const { box, root } = scene(t);
  const claimed = claim(box, root, WANT);
  for (const dir of shardsOf(box, claimed, MADE)) for (const path of TARGET.slice(0, 2)) same(root, dir, path, claimed);
});

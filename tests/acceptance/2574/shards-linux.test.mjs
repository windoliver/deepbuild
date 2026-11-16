// Acceptance test for #2574, AC1 "Shards are made on Linux", written blind from the issue at base 1e3b798c5.
// Surface: claimShards(root, want, say) from scripts/shards.mjs, run in a child node whose HOME is a temporary folder
// (so homedir() and ~/deepbuild-shards resolve there) with DEEP_TEST_SHARD_FLOOR=0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const shards = pathToFileURL(join(repo, 'scripts/shards.mjs')).href;

const put = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const git = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};

// One child node per claim: claims `want` shards of `root`, records every say line and returned dir, releases them all.
function claim(home, root, want) {
  const script = `
    const { claimShards } = await import(${JSON.stringify(shards)});
    const lines = [];
    const got = await claimShards(${JSON.stringify(root)}, ${want}, (line) => lines.push(line));
    for (const shard of got) shard.release();
    console.log(JSON.stringify({ lines, dirs: got.map((shard) => shard.dir) }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, DEEP_TEST_SHARD_FLOOR: '0' },
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `claim child failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('AC1: claimShards makes shards on Linux, holding the worktree, and reuses them after an edit', { skip: process.platform === 'darwin' && 'AC1 is the off-macOS case' }, (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'deep-2574-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const home = join(scratch, 'home');
  const root = join(scratch, 'root');
  mkdirSync(home);
  mkdirSync(root);

  git(root, ['init', '-q']);
  put(join(root, '.gitignore'), 'node_modules/\ndist/\ntarget/\n');
  put(join(root, 'committed.txt'), 'committed bytes\n');
  put(join(root, 'package.json'), '{"name":"scratch","private":true,"workspaces":["packages/*"]}\n');
  put(join(root, 'packages/p/package.json'), '{"name":"@scratch/p"}\n');
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base']);
  put(join(root, 'untracked.txt'), 'untracked bytes\n');
  put(join(root, 'node_modules/dep/index.js'), 'module.exports = 1;\n');
  put(join(root, 'packages/p/dist/main.js'), 'console.log("built");\n');
  put(join(root, 'target/debug/worktree-build'), 'worktree target bytes\n');
  // The untracked file is not ignored: git lists it as untracked.
  assert.match(git(root, ['status', '--porcelain']), /\?\? untracked\.txt/);

  const want = 2;
  const first = claim(home, root, want);
  assert.deepEqual(first.lines.filter((line) => line.includes('not used')), [], 'no shard is "not used"');
  assert.equal(first.dirs.length, want, `claimShards returns ${want} shards`);
  for (const dir of first.dirs) {
    const k = dir.split('/').at(-1);
    assert.equal(dir, join(home, 'deepbuild-shards', k));
    assert.ok(
      first.lines.some((line) => new RegExp(`^SHARD ${k} ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: made, at tree [0-9a-f]{40,64}, node_modules cloned$`).test(line)),
      `say got the made line for shard ${k}: ${JSON.stringify(first.lines)}`,
    );
    assert.equal(readFileSync(join(dir, 'committed.txt'), 'utf8'), 'committed bytes\n');
    assert.equal(readFileSync(join(dir, 'untracked.txt'), 'utf8'), 'untracked bytes\n');
    assert.equal(readFileSync(join(dir, 'node_modules/dep/index.js'), 'utf8'), 'module.exports = 1;\n');
    assert.equal(readFileSync(join(dir, 'packages/p/dist/main.js'), 'utf8'), 'console.log("built");\n');
    assert.ok(!existsSync(join(dir, 'target/debug/worktree-build')), `new shard ${k} holds no target/ of the worktree's`);
  }

  // An edit in root, then a second claim of the same shard: reused, with the edited bytes.
  put(join(root, 'committed.txt'), 'edited committed bytes\n');
  put(join(root, 'untracked.txt'), 'edited untracked bytes\n');
  const second = claim(home, root, 1);
  assert.deepEqual(second.lines.filter((line) => line.includes('not used')), [], 'no shard is "not used" on the second claim');
  assert.equal(second.dirs.length, 1);
  const [dir] = second.dirs;
  assert.ok(first.dirs.includes(dir), 'the second claim takes a shard made by the first');
  const k = dir.split('/').at(-1);
  assert.ok(
    second.lines.some((line) => line.startsWith(`SHARD ${k} ${dir}: reused, at tree `)),
    `say got the reused line for shard ${k}: ${JSON.stringify(second.lines)}`,
  );
  assert.equal(readFileSync(join(dir, 'committed.txt'), 'utf8'), 'edited committed bytes\n');
  assert.equal(readFileSync(join(dir, 'untracked.txt'), 'utf8'), 'edited untracked bytes\n');
});

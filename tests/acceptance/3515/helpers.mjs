// Helpers for #3515's acceptance tests, written blind from the issue at base b134dd38f. Each claim runs claimShards in
// a child node whose HOME is a temporary folder (so ~/deepbuild-shards resolves there), never the machine's shards.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A Terminal tab's GIT_CONFIG_PARAMETERS (safe.bareRepository=explicit) is not the test's; git here and in every child
// runs without it.
delete process.env.GIT_CONFIG_PARAMETERS;

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const shards = pathToFileURL(join(repo, 'scripts/shards.mjs')).href;
export const { exactTree } = await import(pathToFileURL(join(repo, 'scripts/lanes.mjs')).href);

export const put = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
export const git = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};
const ident = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
export const commit = (cwd, message) => {
  git(cwd, ['add', '-A']);
  git(cwd, [...ident, 'commit', '-q', '-m', message]);
};

/** A scratch folder with home/ in it, removed after the test. */
export function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3515-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'home'));
  return { dir, home: join(dir, 'home') };
}

/** Repository A, the one that makes the shard: a committed file and an ignored node_modules/. */
export function repoA(path) {
  mkdirSync(path);
  git(path, ['init', '-q']);
  put(join(path, '.gitignore'), 'node_modules/\n');
  put(join(path, 'committed.txt'), 'A committed bytes\n');
  commit(path, 'A base');
  put(join(path, 'node_modules/dep/index.js'), 'module.exports = 1;\n');
}

/**
 * Clone B of A, a real separate clone (--no-local copies objects, no alternates), then a commit and an untracked file
 * of its own: its HEAD and exact tree live only in B's objects. Returns { head, tree }.
 */
export function cloneB(from, path) {
  git(dirname(path), ['clone', '-q', '--no-local', from, path]);
  assert.ok(!existsSync(join(path, '.git/objects/info/alternates')), 'B borrows no objects');
  put(join(path, 'b-only.txt'), `B committed bytes ${path}\n`);
  commit(path, 'B only');
  put(join(path, 'b-untracked.txt'), `B untracked bytes ${path}\n`);
  put(join(path, 'node_modules/dep/index.js'), 'module.exports = 1;\n');
  const head = git(path, ['rev-parse', 'HEAD']).trim();
  const tree = exactTree(path);
  assert.match(tree ?? '', /^[0-9a-f]{40,64}$/, 'exactTree gives B a tree');
  assert.notEqual(tree, git(path, ['rev-parse', 'HEAD^{tree}']).trim(), "B's exact tree holds its untracked file");
  // Neither is in A's objects.
  for (const id of [head, tree]) assert.notEqual(spawnSync('git', ['cat-file', '-e', id], { cwd: from }).status, 0, `${id} is not in A`);
  return { head, tree };
}

/** One child node per claim: claimShards(root, want, say); its say lines and dirs, its stderr apart. Releases all. */
export function claim(home, root, want, env = {}) {
  const script = `
    const { claimShards } = await import(${JSON.stringify(shards)});
    const lines = [];
    const got = await claimShards(${JSON.stringify(root)}, ${want}, (line) => lines.push(line));
    for (const shard of got) shard.release();
    process.stdout.write(JSON.stringify({ lines, dirs: got.map((shard) => shard.dir) }) + '\\n');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, DEEP_TEST_SHARD_FLOOR: '0', ...env },
    timeout: 120_000,
  });
  assert.equal(result.status, 0, `claim child failed: ${result.stderr}`);
  return { ...JSON.parse(result.stdout.trim().split('\n').at(-1)), stderr: result.stderr };
}

/** A shard's alternates, one entry per line, as written. */
export const alternates = (dir) => readFileSync(join(dir, '.git/objects/info/alternates'), 'utf8').split('\n').filter(Boolean);
/** An alternates entry as a full path (git reads a relative one from the shard's objects folder), real where it exists. */
export const where = (dir, line) => {
  const path = resolve(join(dir, '.git/objects'), line);
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
export const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

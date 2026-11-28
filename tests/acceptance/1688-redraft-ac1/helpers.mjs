import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { cleanEnv } from '../1688/helpers.mjs';

const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };

function git(repo, args, { index, input } = {}) {
  const r = spawnSync('git', args, { cwd: repo, env: cleanEnv({ ...IDENTITY, ...(index ? { GIT_INDEX_FILE: index } : {}) }), input, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed in a scratch copy: ${String(r.stderr).trim()}`);
  return r.stdout;
}

export function widenBase(repo, sandbox) {
  const index = join(sandbox, 'tmp', 'widened-index');
  const mainTree = git(repo, ['rev-parse', 'refs/remotes/origin/main^{tree}']).trim();
  const headTree = git(repo, ['rev-parse', 'HEAD^{tree}']).trim();
  const sources = git(repo, ['ls-tree', '-r', '-z', '--name-only', mainTree, '--', 'packages/']).split('\0').filter((p) => /^packages\/[^/]+\/src\//.test(p));
  try {
    git(repo, ['read-tree', mainTree], { index });
    git(repo, ['update-index', '-z', '--force-remove', '--stdin'], { index, input: sources.map((p) => `${p}\0`).join('') });
    const bare = git(repo, ['write-tree'], { index }).trim();
    const below = git(repo, ['commit-tree', bare, '-m', 'merge base without packages/*/src']).trim();
    const main = git(repo, ['commit-tree', mainTree, '-p', below, '-m', 'merge base']).trim();
    const head = git(repo, ['commit-tree', headTree, '-p', main, '-m', 'change']).trim();
    git(repo, ['update-ref', 'refs/heads/change', head]);
    git(repo, ['update-ref', 'refs/remotes/origin/main', below]);
  } finally {
    rmSync(index, { force: true });
  }
  return sources;
}

export function changeAgainstBase(repo) {
  const merged = git(repo, ['merge-base', 'HEAD', 'origin/main']).trim();
  return git(repo, ['diff', '-z', '--name-only', '--no-renames', merged]).split('\0').filter(Boolean);
}

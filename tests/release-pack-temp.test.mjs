// A refused pack removes its temporary folder. fail() exits the process, which skips the finally that removes it,
// so every refused pack used to leave its whole clean checkout behind in the temp folder (6-7 GB each on a Mac).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/release-pack.mjs', import.meta.url));

test('a pack refused for a missing bin leaves no release-pack folder in the temp folder', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-pack-temp-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const temp = join(root, 'temp');
  mkdirSync(repo);
  mkdirSync(temp);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'planted', version: '1.0.0', bin: { planted: 'bin/missing.js' } }));
  const env = { PATH: process.env.PATH ?? '', HOME: root, TMPDIR: temp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', npm_config_registry: 'http://127.0.0.1:9' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'planted');
  const r = spawnSync(process.execPath, [script, '--repo', repo, '--commit', git('rev-parse', 'HEAD'), '--out', join(root, 'out')], { env, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /bin bin\/missing\.js is not in the archive/);
  assert.deepEqual(readdirSync(temp).filter((n) => n.startsWith('release-pack-')), []);
});

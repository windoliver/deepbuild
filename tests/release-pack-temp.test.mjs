// A refused or stopped pack removes its temporary folder and never reports success. fail() exits the process and a
// stop signal ends it, both skipping the finally that removes the folder, so each used to leave its whole clean
// checkout behind in the temp folder (6-7 GB each on a Mac); a stop the pack's synchronous run never read let it finish.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const env = { PATH: process.env.PATH ?? '', HOME: root, TMPDIR: temp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'planted');
  const r = spawnSync(process.execPath, [script, '--repo', repo, '--commit', git('rev-parse', 'HEAD'), '--out', join(root, 'out')], { env, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /bin bin\/missing\.js is not in the archive/);
  assert.deepEqual(readdirSync(temp).filter((n) => n.startsWith('release-pack-')), []);
});

test('a pack whose process group is stopped by SIGTERM or SIGINT leaves no release-pack folder', async (t) => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const root = mkdtempSync(join(tmpdir(), 'release-pack-temp-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const repo = join(root, 'repo');
    const temp = join(root, 'temp');
    const bin = join(root, 'bin');
    for (const d of [repo, temp, bin]) mkdirSync(d);
    // A git whose clone hangs after it finishes, so the stop lands while the pack's temp folder holds a checkout. The
    // marker is written once git has exited, so the stop never lands on a git that may finish anyway: a shell waiting on
    // a child that outlives SIGINT goes on to the hang, and the pack then completes with the signal unread.
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const hung = join(root, 'hung');
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = clone ]; then "${realGit}" "$@" || exit $?; : > "${hung}"; exec sleep 60; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'planted', version: '1.0.0' }));
    const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root, TMPDIR: temp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    const git = (...args) => execFileSync(realGit, args, { cwd: repo, env, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'planted');
    const child = spawn(process.execPath, [script, '--repo', repo, '--commit', git('rev-parse', 'HEAD'), '--out', join(root, 'out')], { env, detached: true, stdio: 'ignore' });
    t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } });
    const exited = new Promise((done) => child.on('exit', (code, sig) => done({ code, sig })));
    const packed = () => readdirSync(temp).filter((n) => n.startsWith('release-pack-'));
    // deadline: bounds the wait for the pack's clone to land, which the planted git then holds open
    for (const end = Date.now() + 30_000; !existsSync(hung); ) {
      assert.ok(Date.now() < end, `${signal}: the pack never cloned into its temp folder`);
      await new Promise((r) => setImmediate(r));
    }
    process.kill(-child.pid, signal);
    const { code } = await exited;
    assert.notEqual(code, 0, `${signal}: a stopped pack must not report success`);
    assert.deepEqual(packed(), [], `${signal}: the stopped pack left its temp folder`);
  }
});

test('a pack sent SIGTERM alone while its child runs on stops once the child returns, writing nothing', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-pack-temp-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const temp = join(root, 'temp');
  const bin = join(root, 'bin');
  const out = join(root, 'out');
  for (const d of [repo, temp, bin]) mkdirSync(d);
  // A git whose clone, once finished, holds until the test lets it go: the stop goes to the pack's pid alone, so the
  // child never sees it and returns normally, and the pack must still act on the stop rather than finish the pack.
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const [hung, release] = [join(root, 'hung'), join(root, 'release')];
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = clone ]; then "${realGit}" "$@" || exit $?; : > "${hung}"; while [ ! -e "${release}" ]; do sleep 0.05; done; exit 0; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'planted', version: '1.0.0' }));
  const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root, TMPDIR: temp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => execFileSync(realGit, args, { cwd: repo, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'planted');
  const child = spawn(process.execPath, [script, '--repo', repo, '--commit', git('rev-parse', 'HEAD'), '--out', out], { env, detached: true, stdio: 'ignore' });
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } });
  const exited = new Promise((done) => child.on('exit', (code, sig) => done({ code, sig })));
  // deadline: bounds the wait for the pack's clone to land, which the planted git then holds open
  for (const end = Date.now() + 30_000; !existsSync(hung); ) {
    assert.ok(Date.now() < end, 'the pack never cloned into its temp folder');
    await new Promise((r) => setImmediate(r));
  }
  process.kill(child.pid, 'SIGTERM');
  writeFileSync(release, '');
  const { code, sig } = await exited;
  assert.ok(code !== 0 || sig !== null, `a pack stopped by SIGTERM reported success (code ${code})`);
  assert.equal(existsSync(join(out, 'manifest.json')), false, 'a stopped pack wrote its manifest');
  assert.deepEqual(readdirSync(temp).filter((n) => n.startsWith('release-pack-')), [], 'the stopped pack left its temp folder');
});

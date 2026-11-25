// A refused or stopped pack removes its temporary folder and never reports success. fail() exits the process and a
// stop signal ends it, both skipping the finally that removes the folder, so each used to leave its whole clean
// checkout behind in the temp folder (6-7 GB each on a Mac); a stop the pack's synchronous run never read let it finish.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/release-pack.mjs', import.meta.url));
// The pack's watcher names the folder it removes on its command line, so one still alive shows there.
const watchersGone = async (temp) => {
  const naming = () => execFileSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter((l) => l.includes(temp) && !l.startsWith('ps '));
  // deadline: bounds the wait for the watcher's next poll to see the folder gone and exit
  for (const end = Date.now() + 10_000; naming().length; ) {
    assert.ok(Date.now() < end, `a process outlived the pack's folder: ${naming().join(' | ').slice(0, 300)}`);
    await new Promise((r) => setImmediate(r));
  }
};

test('a pack refused for a missing bin leaves no release-pack folder in the temp folder', async (t) => {
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
  await watchersGone(temp);
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

test('a pack killed outright with its process group, as a test timeout kills it, leaves no release-pack folder', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-pack-temp-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const temp = join(root, 'temp');
  const bin = join(root, 'bin');
  for (const d of [repo, temp, bin]) mkdirSync(d);
  // The same hanging clone: SIGKILL runs nothing in the pack, so only what outlives it can remove the folder.
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
    assert.ok(Date.now() < end, 'the pack never cloned into its temp folder');
    await new Promise((r) => setImmediate(r));
  }
  process.kill(-child.pid, 'SIGKILL');
  assert.equal((await exited).sig, 'SIGKILL');
  // deadline: bounds the wait for the folder to go once the pack is gone
  for (const end = Date.now() + 30_000; packed().length; ) {
    assert.ok(Date.now() < end, `the killed pack left its temp folder: ${packed().join(', ')}`);
    await new Promise((r) => setImmediate(r));
  }
  await watchersGone(temp);
});

test('a pack killed outright alone, its clone writing on into the folder after it, leaves no release-pack folder', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-pack-temp-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const temp = join(root, 'temp');
  const bin = join(root, 'bin');
  for (const d of [repo, temp, bin]) mkdirSync(d);
  // As a harness timeout kills only the pack's pid: its clone runs on, then writes under the folder, as git and the
  // stage step do, after the pack is gone.
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const hung = join(root, 'hung');
  const release = join(root, 'release');
  const wrote = join(root, 'wrote');
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = clone ]; then "${realGit}" "$@" || exit $?; : > "${hung}"; n=0; while [ ! -e "${release}" ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done; for last; do :; done; mkdir -p "$last/late"; : > "${wrote}"; exit 0; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
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
    assert.ok(Date.now() < end, 'the pack never cloned into its temp folder');
    await new Promise((r) => setImmediate(r));
  }
  process.kill(child.pid, 'SIGKILL');
  assert.equal((await exited).sig, 'SIGKILL');
  // deadline: bounds the window, four of the watcher's polls, in which one acting on the pack's death alone would act
  for (const end = Date.now() + 2_000; Date.now() < end; ) {
    assert.ok(packed().length, 'the folder went while the clone the killed pack left still wrote in it');
    await new Promise((r) => setImmediate(r));
  }
  writeFileSync(release, '');
  // deadline: bounds the wait for the clone's late write
  for (const end = Date.now() + 30_000; !existsSync(wrote); ) {
    assert.ok(Date.now() < end, 'the planted clone never wrote after the pack was killed');
    await new Promise((r) => setImmediate(r));
  }
  // deadline: bounds the wait for the folder to go once the clone, the last thing writing in it, has ended
  for (const end = Date.now() + 30_000; packed().length; ) {
    assert.ok(Date.now() < end, `the killed pack left its temp folder: ${packed().join(', ')}`);
    await new Promise((r) => setImmediate(r));
  }
  await watchersGone(temp);
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
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = clone ]; then "${realGit}" "$@" || exit $?; : > "${hung}"; n=0; while [ ! -e "${release}" ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done; exit 0; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
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

test('a pack stopped while it writes its out folder removes the archive and manifest it wrote there', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-pack-temp-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const temp = join(root, 'temp');
  const out = join(root, 'out');
  for (const d of [repo, temp, out]) mkdirSync(d);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'planted', version: '1.0.0' }));
  const env = { PATH: process.env.PATH ?? '', HOME: root, TMPDIR: temp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'planted');
  // The manifest's path is a FIFO, so the pack's write of it holds until the test reads it: the stop lands with the
  // archive already copied to <out> and the manifest being written.
  const manifest = join(out, 'manifest.json');
  execFileSync('mkfifo', [manifest]);
  const child = spawn(process.execPath, [script, '--repo', repo, '--commit', git('rev-parse', 'HEAD'), '--out', out], { env, detached: true, stdio: 'ignore' });
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } });
  const exited = new Promise((done) => child.on('exit', (code, sig) => done({ code, sig })));
  // deadline: bounds the wait for the pack to copy its archive to <out>, after which it opens the manifest
  for (const end = Date.now() + 30_000; !existsSync(join(out, 'planted-1.0.0.tgz')); ) {
    assert.ok(Date.now() < end, 'the pack never copied its archive to its out folder');
    await new Promise((r) => setImmediate(r));
  }
  process.kill(child.pid, 'SIGTERM');
  // Read without blocking: a blocking open that pairs with the pack's open as the stop interrupts it reads EOF at once
  // (macOS), and the pack's retried open then waits for a reader that has gone. Until the pack writes, a read finds no
  // writer or no bytes; the manifest is read once its writer has closed it.
  const fd = openSync(manifest, constants.O_RDONLY | constants.O_NONBLOCK);
  const chunk = Buffer.alloc(1 << 16);
  let written = '';
  try {
    // deadline: bounds the wait for the stopped pack to write its manifest
    for (const end = Date.now() + 30_000; ; ) {
      let n = -1;
      try { n = readSync(fd, chunk); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
      if (n > 0) written += chunk.toString('utf8', 0, n);
      else if (n === 0 && written) break;
      assert.ok(Date.now() < end, 'the stopped pack never wrote its manifest');
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    closeSync(fd);
  }
  assert.match(written, /"planted"/);
  const { code, sig } = await exited;
  assert.ok(code !== 0 || sig !== null, `a pack stopped by SIGTERM reported success (code ${code})`);
  assert.deepEqual(readdirSync(out), [], 'the stopped pack left what it wrote to its out folder');
  assert.deepEqual(readdirSync(temp).filter((n) => n.startsWith('release-pack-')), [], 'the stopped pack left its temp folder');
});

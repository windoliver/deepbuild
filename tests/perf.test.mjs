import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const scripts = new URL('../scripts/', import.meta.url);
// perf takes the throttle's timed class, so the fixtures share a table of their own, and the suite holds one timed
// grant in it for every run, as a preflight does for its perf: each run passes through on it instead of waiting.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-perf-home-')));
const { acquire, release } = await import(new URL('throttle.mjs', scripts));
const inHome = (act) => {
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    return act();
  } finally {
    process.env.HOME = previous;
  }
};
const grant = inHome(() => acquire('timed', { wait: 60 }));
assert.ok(grant, 'no timed grant came within 60 min');
after(() => {
  inHome(() => release(grant));
  rmSync(home, { recursive: true, force: true });
});

// A throwaway repository whose merge base already has budgets, so perf measures a real base.
function repository(t, checks) {
  // perf keeps its copies in the user's cache directory, so each fixture gets one of its own beside it.
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'deep-perf-test-')));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const cwd = join(box, 'repo');
  const cache = join(box, 'cache');
  for (const directory of [cwd, cache]) mkdirSync(directory);
  mkdirSync(join(cwd, 'benchmarks'));
  // perf imports scripts beside it, and nothing from node_modules: a fixture, as other issues' tests make, has none.
  cpSync(fileURLToPath(scripts), join(cwd, 'scripts'), { recursive: true });
  const files = {
    'scripts/checks.mjs': checks(cwd),
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: `node -e "require('node:fs').writeFileSync('warm', '')"` } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture base.' }, tasks: [] }),
    '.gitignore': 'warm\nnode_modules/\n',
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: cache, DEEP_THROTTLE: grant.token };
  delete env.DEEP_PERF_LOCK;
  const perf = (observation) => spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observation)], { cwd, encoding: 'utf8', env });
  return { cwd, git, perf, cache, env };
}

test('the merge base is timed warm, so a slower checkout cannot hide behind its cold build', (t) => {
  // Cold, the merge base's checks burn 3 s of CPU; warm, they take one process start.
  const { perf } = repository(t, () => `
    import { existsSync } from 'node:fs';
    const start = process.cpuUsage();
    if (!existsSync('warm')) for (let used; (used = process.cpuUsage(start)).user + used.system < 3_000_000;);
  `);
  const result = perf({ status: 0, elapsedMs: 1500, cpuMs: 1500, peakBytes: 1 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL perf: preflight: cpuMs 1500 regressed/);
});

test('wall time that only machine load stretched is not a regression', (t) => {
  const { perf } = repository(t, () => '');
  const result = perf({ status: 0, elapsedMs: 60_000, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"task":"preflight"[^\n]*"status":"PASS"/);
});

test('a merge base whose archive is larger than a process buffer is still copied', (t) => {
  // The Mac's merge base archives to 141 MiB; a copy read through a 128 MiB buffer stopped perf with ENOBUFS.
  const { cwd, git, perf } = repository(t, () => '');
  const big = openSync(join(cwd, 'big.bin'), 'w');
  for (let mib = 0; mib < 140; mib++) writeSync(big, randomBytes(1 << 20));
  closeSync(big);
  git('add', 'big.bin');
  git('commit', '-qm', 'big');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^perf: base copy .*: wrote \d+ files/m);
});

test('a checkout without origin/main is blocked with the fetch that fixes it', (t) => {
  const { git, perf } = repository(t, () => '');
  git('update-ref', '-d', 'refs/remotes/origin/main');
  const result = perf({ status: 0, elapsedMs: 1, peakBytes: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCKED perf: .*origin\/main.*\n\s+Fix: .*git fetch origin main/);
});

test('a failed checkout is blocked without building the merge base', (t) => {
  const { cwd, perf } = repository(t, (root) => `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(root, 'base-ran'))}, '');`);
  const result = perf({ status: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCKED perf: .+\n\s+Fix: .+/);
  assert.equal(existsSync(join(cwd, 'base-ran')), false);
});

test('the full run with the change\'s own tests is still held to the peak-memory cap', (t) => {
  // The run without the change's tests also regresses against the base, so neither failure may hide the other.
  const { cwd, git, perf } = repository(t, () => `
    // 500 ms against one node start, which would have to read over 313 ms to hide it (#1421).
    if (process.cwd().includes('without-tests')) { const start = process.cpuUsage(); for (let used; (used = process.cpuUsage(start)).user + used.system < 500_000;); }
  `);
  writeFileSync(join(cwd, 'benchmarks/budgets.json'), JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000, peakBytes: 1e9 }, initialReason: 'Fixture base.' }, tasks: [] }));
  git('commit', '-qam', 'cap');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(join(cwd, 'tests'));
  writeFileSync(join(cwd, 'tests/added.test.mjs'), '');
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 2e9 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL perf: preflight: peakBytes 2000000000 reached cap 1000000000/);
  assert.match(result.stdout, /FAIL perf: preflight: cpuMs \d+ regressed beyond base/);
});

test('a copy\'s checks get the budget\'s allowance, not a fixed one: a run past elapsedMs plus its margin is stopped', (t) => {
  // The checks of each copy take 3 s; this checkout's own run is the observation passed in.
  const fixture = (elapsedMs) => {
    const { cwd, git, perf } = repository(t, (root) => `
      if (process.cwd() !== ${JSON.stringify(root)}) await new Promise((done) => setTimeout(done, 3000));
    `);
    writeFileSync(join(cwd, 'benchmarks/budgets.json'), JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs }, initialReason: 'Fixture base.' }, tasks: [] }));
    git('commit', '-qam', 'budget');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    return perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  };
  const stopped = fixture(1000);
  assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
  assert.match(stopped.stdout, /BLOCKED perf: [^\n]*ETIMEDOUT/);
  const allowed = fixture(4000);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.match(allowed.stdout, /"task":"preflight"[^\n]*"status":"PASS"/);
});

test('the copy without the change\'s own tests gets the same allowance: a run past it is stopped', (t) => {
  // Only the copy without the change's tests is slow, so the merge base's run passes and this one must stop.
  const { cwd, git, perf } = repository(t, () => `
    if (process.cwd().includes('without-tests')) await new Promise((done) => setTimeout(done, 3000));
  `);
  writeFileSync(join(cwd, 'benchmarks/budgets.json'), JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 1000 }, initialReason: 'Fixture base.' }, tasks: [] }));
  git('commit', '-qam', 'budget');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(join(cwd, 'tests'));
  writeFileSync(join(cwd, 'tests/added.test.mjs'), '');
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BLOCKED perf: [^\n]*ETIMEDOUT/);
});

test('the merge base builds at one path every run, outside the checkout, from files stamped now', (t) => {
  // Cargo doesn't rebuild a crate whose workspace moved, or one whose sources look older than its
  // last build, so a copy that moves or keeps commit times runs stale binaries (#594).
  const { cwd, perf } = repository(t, (root) => `
    import { appendFileSync, statSync } from 'node:fs';
    appendFileSync(${JSON.stringify(join(root, 'base-runs'))}, JSON.stringify({ cwd: process.cwd(), target: process.env.CARGO_TARGET_DIR, mtimeMs: statSync('scripts/checks.mjs').mtimeMs }) + '\\n');
  `);
  const dated = { ...process.env, GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z' };
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--amend', '--no-edit'], { cwd, env: dated });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd });
  const started = Date.now();
  for (let run = 0; run < 2; run++) {
    const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const runs = readFileSync(join(cwd, 'base-runs'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(runs.length, 2);
  assert.equal(runs[0].cwd, runs[1].cwd, 'the merge-base copy moved between runs');
  assert.ok(!runs[0].cwd.startsWith(`${cwd}/`), `the merge-base copy was inside the checkout: ${runs[0].cwd}`);
  assert.equal(runs[0].target, runs[1].target, 'the merge base built into another directory on the second run');
  assert.ok(runs[0].target && !runs[0].target.startsWith(`${runs[0].cwd}/`), `the merge base built inside its copy: ${runs[0].target}`);
  for (const { mtimeMs } of runs) assert.ok(mtimeMs >= started - 1000, `the merge base kept its commit time ${new Date(mtimeMs).toISOString()}, which Cargo reads as fresh`);
});

// The directory perf keeps this clone's copies in on this machine, under the fixture's cache directory.
const keptRoot = (cache, cwd) => join(cache, 'deepbuild-perf', `${hostname().split('.')[0].replace(/[^\w-]/g, '_')}-${createHash('sha256').update(realpathSync(join(cwd, '.git'))).digest('hex').slice(0, 12)}`);

test('kept copies another user could write to are refused, since perf runs what it builds there', (t) => {
  const { cwd, perf, cache } = repository(t, () => '');
  mkdirSync(keptRoot(cache, cwd), { recursive: true });
  chmodSync(keptRoot(cache, cwd), 0o777);
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BLOCKED perf: .+ is not a directory only this user can use\n\s+Fix: Remove it/);
});

test('another repository on the machine keeps copies and a lock of its own: a fixture\'s perf never blocks or replaces a clone\'s', async (t) => {
  // Each run's base checks record where they ran; the first run's wait in its checks, holding its lock, until told to go
  // or until the test's folder is gone.
  // They burn 50 ms of CPU, which GNU time's 10 ms steps never read as none.
  const workload = (root) => `
    import { appendFileSync, existsSync } from 'node:fs';
    for (const start = process.cpuUsage(); process.cpuUsage(start).user < 50_000;);
    appendFileSync(${JSON.stringify(join(root, 'base-cwd'))}, process.cwd() + '\\n');
    while (!existsSync(${JSON.stringify(join(root, 'go'))}) && existsSync(${JSON.stringify(root)})) await new Promise((done) => setTimeout(done, 20));
  `;
  const one = repository(t, workload), other = repository(t, workload);
  writeFileSync(join(other.cwd, 'go'), '');
  const observation = JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  const first = spawn(process.execPath, ['scripts/perf.mjs', observation], { cwd: one.cwd, env: one.env });
  let output = '';
  first.stdout.on('data', (chunk) => { output += chunk; });
  const closed = new Promise((done) => first.on('close', (status) => done(status)));
  for (const until = Date.now() + 120_000; !existsSync(join(one.cwd, 'base-cwd'));) {
    assert.ok(Date.now() < until, `the first run's checks didn't start within 120 s\n${output}`);
    await new Promise((done) => setTimeout(done, 20));
  }
  // The same machine and cache, from another repository, while the first run holds its copies.
  const second = spawnSync(process.execPath, ['scripts/perf.mjs', observation], { cwd: other.cwd, encoding: 'utf8', env: { ...other.env, XDG_CACHE_HOME: one.cache } });
  writeFileSync(join(one.cwd, 'go'), '');
  assert.equal(await closed, 0, output);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const [mine] = readFileSync(join(one.cwd, 'base-cwd'), 'utf8').trim().split('\n'), [theirs] = readFileSync(join(other.cwd, 'base-cwd'), 'utf8').trim().split('\n');
  assert.notEqual(theirs, mine, 'the other repository\'s perf ran its checks in this clone\'s kept copy');
});

test('a Mac whose name gains a network\'s domain keeps one folder: a run under any of its names uses the same copies', (t) => {
  const { cwd, cache, env } = repository(t, (root) => `
    import { appendFileSync } from 'node:fs';
    for (const start = process.cpuUsage(); process.cpuUsage(start).user < 50_000;);
    appendFileSync(${JSON.stringify(join(root, 'base-cwd'))}, process.cwd() + '\\n');
  `);
  // The machine's name is the OS's to give; the preload gives the one each run names.
  const named = join(cache, '..', 'hostname.cjs');
  writeFileSync(named, "const os = require('node:os'); os.hostname = () => process.env.FIXTURE_HOSTNAME; require('node:module').syncBuiltinESMExports();");
  // macOS adds .local on some networks, and a router's DHCP its own domain, such as .attlocal.net.
  for (const name of ['fixture-mac.local', 'fixture-mac.attlocal.net', 'fixture-mac']) {
    const result = spawnSync(process.execPath, ['-r', named, 'scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })], { cwd, encoding: 'utf8', env: { ...env, FIXTURE_HOSTNAME: name } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const copies = readFileSync(join(cwd, 'base-cwd'), 'utf8').trim().split('\n');
  assert.equal(copies.length, 3, copies.join('\n'));
  assert.equal(new Set(copies).size, 1, `the copies moved when the machine's name gained or lost a domain: ${copies.join(', ')}`);
});

test('one perf run per machine at a time: a live run\'s lock blocks, a killed run\'s is taken over and released', (t) => {
  const { cwd, perf, cache } = repository(t, () => '');
  const kept = keptRoot(cache, cwd);
  mkdirSync(kept, { recursive: true, mode: 0o700 });
  writeFileSync(join(kept, 'lock'), String(process.pid));
  const held = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(held.status, 1, held.stdout + held.stderr);
  assert.match(held.stdout, new RegExp(`BLOCKED perf: another perf run \\(process ${process.pid}\\)`));
  assert.equal(readFileSync(join(kept, 'lock'), 'utf8'), String(process.pid), 'the blocked run removed the live run\'s lock');

  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  writeFileSync(join(kept, 'lock'), String(gone));
  const taken = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(taken.status, 0, taken.stdout + taken.stderr);
  assert.equal(existsSync(join(kept, 'lock')), false, 'the run left its lock behind');
  assert.deepEqual(readdirSync(kept), [], 'a run that built nothing left its sides or its lock behind');

  // A run killed between creating the lock and writing its number leaves it empty.
  writeFileSync(join(kept, 'lock'), '');
  const empty = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
});

test('the merge-base copy has an origin/main, so checks that compare with main run there too', (t) => {
  // Without one, repo-rules skips its size check in the copy and the working tree looks 50% slower.
  const { cwd, perf } = repository(t, (root) => `
    import { execFileSync } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(join(root, 'base-main'))}, execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }));
  `);
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(join(cwd, 'base-main'), 'utf8'), /^[0-9a-f]{40}\n$/);
});

test('the copies read the open issues this checkout\'s drift lane fetched, cached beside the kept copy, not fetched again', (t) => {
  const { cwd, cache, perf } = repository(t, (root) => `
    import { readFileSync, writeFileSync } from 'node:fs';
    const file = process.env.DEEP_OPEN_ISSUES;
    writeFileSync(${JSON.stringify(join(root, 'base-issues'))}, JSON.stringify({ file, issues: file && readFileSync(file, 'utf8') }));
  `);
  mkdirSync(join(cwd, 'target'));
  writeFileSync(join(cwd, 'target', 'open-issues.json'), '[{"number":1,"body":"fetched once"}]');
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { file, issues } = JSON.parse(readFileSync(join(cwd, 'base-issues'), 'utf8'));
  assert.equal(issues, '[{"number":1,"body":"fetched once"}]');
  assert.ok(file.startsWith(join(cache, 'deepbuild-perf')), `the cached issues are under the kept copies: ${file}`);
});

test('the copy\'s throwaway repository tracks the merge base\'s files, not the link to its kept builds', (t) => {
  const { cwd, perf } = repository(t, (root) => `
    import { execFileSync } from 'node:child_process';
    import { lstatSync, writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(join(root, 'base-files'))}, JSON.stringify({ tracked: execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\\n').filter(Boolean), link: lstatSync('target').isSymbolicLink() }));
  `);
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { tracked, link } = JSON.parse(readFileSync(join(cwd, 'base-files'), 'utf8'));
  assert.ok(link, 'the copy has no target link to its kept builds');
  assert.ok(!tracked.includes('target'), `the throwaway repository committed the target link: ${tracked.join(', ')}`);
});

test('the copy without the change\'s own tests keeps links as links and skips a checkout\'s own target link', (t) => {
  const { cwd, git, perf } = repository(t, (root) => `
    import { lstatSync, readFileSync, readlinkSync, appendFileSync } from 'node:fs';
    // Both sides measure 200 ms of CPU, so one node start's spread can't read as a regression (#1421).
    { const start = process.cpuUsage(); for (let used; (used = process.cpuUsage(start)).user + used.system < 200_000;); }
    if (process.cwd().includes('without-tests')) appendFileSync(${JSON.stringify(join(root, 'without-links'))}, JSON.stringify({ docs: readlinkSync('docs-link'), target: readlinkSync('target'), outside: lstatSync('outside-link').isFile() && readFileSync('outside-link', 'utf8'), inner: readFileSync('outside-dir-link/inner.txt', 'utf8'), absolute: lstatSync('absolute-link').isSymbolicLink() }));
  `);
  symlinkSync('benchmarks', join(cwd, 'docs-link'));
  // A link out of the checkout would dangle from the copy, so the copy gets what it points at.
  writeFileSync(join(cwd, '..', 'outside.txt'), 'outside');
  symlinkSync('../outside.txt', join(cwd, 'outside-link'));
  mkdirSync(join(cwd, '..', 'outside-dir'));
  writeFileSync(join(cwd, '..', 'outside-dir', 'inner.txt'), 'inner');
  symlinkSync('../outside-dir', join(cwd, 'outside-dir-link'));
  // An absolute link into the checkout would still point at the checkout from the copy.
  symlinkSync(join(cwd, 'benchmarks'), join(cwd, 'absolute-link'));
  git('add', 'docs-link', 'outside-link', 'outside-dir-link', 'absolute-link');
  git('commit', '-qm', 'link');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // A checkout that shares its builds links target/ elsewhere; git lists the link as untracked.
  const elsewhere = join(cwd, '..', 'shared-target');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(cwd, 'target'));
  mkdirSync(join(cwd, 'tests'));
  writeFileSync(join(cwd, 'tests/added.test.mjs'), '');
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const links = JSON.parse(readFileSync(join(cwd, 'without-links'), 'utf8'));
  assert.equal(links.docs, 'benchmarks');
  assert.equal(links.outside, 'outside');
  assert.equal(links.inner, 'inner');
  assert.equal(links.absolute, false, 'the copy kept a link into the original checkout');
  assert.notEqual(links.target, elsewhere, 'the copy built into the checkout\'s own target');
});

test('perf runs racing for a killed run\'s lock never check at the same time', async (t) => {
  const { cwd, cache, env } = repository(t, (root) => `
    import { appendFileSync } from 'node:fs';
    const start = Date.now();
    await new Promise((done) => setTimeout(done, 300));
    appendFileSync(${JSON.stringify(join(root, 'base-spans'))}, JSON.stringify([start, Date.now()]) + '\\n');
  `);
  const kept = keptRoot(cache, cwd);
  mkdirSync(kept, { recursive: true, mode: 0o700 });
  writeFileSync(join(kept, 'lock'), String(spawnSync(process.execPath, ['-e', '']).pid));
  const once = () => new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })], { cwd, env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('close', (status) => done({ status, output }));
  });
  const results = await Promise.all(Array.from({ length: 4 }, once));
  for (const { status, output } of results) if (status !== 0) assert.match(output, /BLOCKED perf: (another perf run|could not take)/, output);
  const spans = readFileSync(join(cwd, 'base-spans'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).sort((a, b) => a[0] - b[0]);
  assert.ok(spans.length >= 1);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], `two runs checked at once: ${JSON.stringify(spans)}`);
  assert.equal(existsSync(join(kept, 'lock')), false, 'a run left the lock behind');
});

// Held at chosen points by a preload, three runs take the interleaving that a busy machine gives by
// chance: A takes the killed run's lock at once; C read the killed pid before that, acts 150 ms later
// on what is now A's live lock and holds it aside for 500 ms; D acts at 300 ms, in C's gap.
test('perf runs racing for a killed run\'s lock never check at the same time, however they interleave', async (t) => {
  const { cwd, cache, env } = repository(t, (root) => `
    import { appendFileSync } from 'node:fs';
    const start = Date.now();
    await new Promise((done) => setTimeout(done, 1000));
    appendFileSync(${JSON.stringify(join(root, 'base-spans'))}, JSON.stringify([start, Date.now()]) + '\\n');
  `);
  const kept = keptRoot(cache, cwd);
  mkdirSync(kept, { recursive: true, mode: 0o700 });
  writeFileSync(join(kept, 'lock'), String(spawnSync(process.execPath, ['-e', '']).pid));
  const preload = fileURLToPath(new URL('fixtures/slow-lock.cjs', import.meta.url));
  const held = (readMs, renameMs) => new Promise((done) => {
    const child = spawn(process.execPath, ['-r', preload, 'scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })],
      { cwd, env: { ...env, SLOW_LOCK_READ_MS: String(readMs), SLOW_LOCK_RENAME_MS: String(renameMs) } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('close', (status) => done({ status, output }));
  });
  const results = await Promise.all([held(0, 0), held(150, 500), held(300, 0)]);
  for (const { status, output } of results) if (status !== 0) assert.match(output, /BLOCKED perf: (another perf run|could not take)/, output);
  const spans = readFileSync(join(cwd, 'base-spans'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(spans.length, 1, `${spans.length} runs checked: ${JSON.stringify(spans)}`);
  assert.equal(existsSync(join(kept, 'lock')), false, 'a run left the lock behind');
});

// The Mac found two runs checking at once in the test above. A run the machine pauses just after making the
// takeover mark leaves it there without its number for that pause; a second run that reads it then must not
// take it for a killed run's. Here the first run's mark stays numberless for 2.5 s, and the second, started
// once the first holds the mark or the lock, reads the lock slowly so that the first comes back in between.
test('a run paused while making the takeover mark keeps it: a second run that finds it waits', async (t) => {
  const { cwd, cache, env } = repository(t, (root) => `
    import { appendFileSync } from 'node:fs';
    const start = Date.now();
    await new Promise((done) => setTimeout(done, 8000));
    appendFileSync(${JSON.stringify(join(root, 'base-spans'))}, JSON.stringify([start, Date.now()]) + '\\n');
  `);
  const kept = keptRoot(cache, cwd);
  mkdirSync(kept, { recursive: true, mode: 0o700 });
  writeFileSync(join(kept, 'lock'), String(spawnSync(process.execPath, ['-e', '']).pid));
  const preload = fileURLToPath(new URL('fixtures/slow-lock.cjs', import.meta.url));
  const held = (slow) => {
    const child = spawn(process.execPath, ['-r', preload, 'scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })],
      { cwd, env: { ...env, ...slow } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    return { child, done: new Promise((done) => child.on('close', (status) => done({ status, output }))) };
  };
  const first = held({ SLOW_MARK_WRITE_MS: '2500' });
  const holds = () => {
    if (existsSync(join(kept, 'lock.takeover'))) return true;
    try {
      return readFileSync(join(kept, 'lock'), 'utf8') === String(first.child.pid);
    } catch {
      return false;
    }
  };
  for (const until = Date.now() + 60_000; !holds();) {
    assert.ok(Date.now() < until, 'the first run took neither the mark nor the lock within 60 s');
    await new Promise((done) => setTimeout(done, 5));
  }
  const second = held({ SLOW_LOCK_READ_MS: '5000' });
  const results = await Promise.all([first.done, second.done]);
  for (const { status, output } of results) if (status !== 0) assert.match(output, /BLOCKED perf: (another perf run|could not take)/, output);
  const spans = readFileSync(join(cwd, 'base-spans'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(spans.length, 1, `${spans.length} runs checked: ${JSON.stringify(spans)}`);
  assert.equal(existsSync(join(kept, 'lock')), false, 'a run left the lock behind');
});

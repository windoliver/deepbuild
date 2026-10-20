import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const scripts = new URL('../scripts/', import.meta.url);

// A throwaway repository whose merge base already has budgets, so perf measures a real base.
function repository(t, checks) {
  // perf keeps its copies in the user's cache directory, so each fixture gets one of its own beside it.
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'deep-perf-test-')));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const cwd = join(box, 'repo');
  const cache = join(box, 'cache');
  for (const directory of [cwd, cache]) mkdirSync(directory);
  for (const directory of ['scripts', 'benchmarks']) mkdirSync(join(cwd, directory));
  for (const file of ['perf.mjs', 'benchmark.mjs', 'lanes.mjs']) copyFileSync(new URL(file, scripts), join(cwd, 'scripts', file));
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
  const perf = (observation) => spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observation)], { cwd, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: cache } });
  return { cwd, git, perf, cache };
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
    if (process.cwd().includes('without-tests')) { const start = process.cpuUsage(); for (let used; (used = process.cpuUsage(start)).user + used.system < 200_000;); }
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

// The directory perf keeps a checkout's copies in, under the fixture's cache directory.
const keptRoot = (cwd, cache) => join(cache, 'deepbuild-perf', createHash('sha256').update(cwd).digest('hex').slice(0, 16));

test('kept copies another user could write to are refused, since perf runs what it builds there', (t) => {
  const { cwd, perf, cache } = repository(t, () => '');
  mkdirSync(keptRoot(cwd, cache), { recursive: true });
  chmodSync(keptRoot(cwd, cache), 0o777);
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BLOCKED perf: .+ is not a directory only this user can use\n\s+Fix: Remove it/);
});

test('one perf run per checkout at a time: a live run\'s lock blocks, a killed run\'s is taken over and released', (t) => {
  const { cwd, perf, cache } = repository(t, () => '');
  const kept = keptRoot(cwd, cache);
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
  const { cwd, cache } = repository(t, (root) => `
    import { appendFileSync } from 'node:fs';
    const start = Date.now();
    await new Promise((done) => setTimeout(done, 300));
    appendFileSync(${JSON.stringify(join(root, 'base-spans'))}, JSON.stringify([start, Date.now()]) + '\\n');
  `);
  const kept = keptRoot(cwd, cache);
  mkdirSync(kept, { recursive: true, mode: 0o700 });
  writeFileSync(join(kept, 'lock'), String(spawnSync(process.execPath, ['-e', '']).pid));
  const once = () => new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })], { cwd, env: { ...process.env, XDG_CACHE_HOME: cache } });
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

// #3179: on PR #3177's branch, `node scripts/proof.mjs guard` finishes in under 60 s wall and starts no more than
// 200 git processes, and prints the verdict lines and exit code it printed before the change. Reached by running
// the program under test's `scripts/proof.mjs guard` once in a fresh GitHub clone checked out at that PR's head,
// with origin/main pinned to its merge base (README). Both criteria are judged from that one run.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The program under test: a folder holding scripts/proof.mjs and package.json. This checkout unless named.
const PROGRAM = realpathSync(resolve(process.env.DEEP_3179_SCRIPTS || join(HERE, '../../..')));
const REPO = 'https://github.com/windoliver/deepbuild.git';
const HEAD = 'ab84620ff34d'; // PR #3177's head
const MAIN = '83b82f94ad44'; // its merge base, where origin/main is pinned
const WALL_LIMIT_MS = 60_000;
const GIT_LIMIT = 200;
// Criterion 2 doesn't bound the time; this cap only keeps the suite's own wait bounded (README).
const VERDICT_CAP_MS = 20 * 60_000;
const VERDICT = /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) |^ {2}Fix: /;
// The issue's "before": the guard's stdout on this clone and commit, without its `proof: wall time` line; exit 0.
const EXPECTED = [
  "PASS guard: scripts/proof-approvals.mjs: the proof lanes' own code changed, by approved proposal (commit 121029241adb)",
  'PASS guard: tests/acceptance/3163/BASE-FAILURE.txt: deleted (criterion #3163.9c395067, #3163.d0eabe65), by approved proposal (commit 018f61ab3e4c)',
  'PASS guard: tests/acceptance/3163/README.md: deleted (criterion #3163.9c395067, #3163.d0eabe65), by approved proposal (commit 018f61ab3e4c)',
  "PASS guard: tests/acceptance/3163/guard.test.mjs › #3163.9c395067 on PR #3093's branch in a fresh GitHub clone, node scripts/proof.mjs guard finishes in under 60 s wall, with the load at start and end recorded, and starts no more than 200 git processes: deleted (criterion #3163.9c395067), by approved proposal (commit 018f61ab3e4c)",
  'PASS guard: tests/acceptance/3163/guard.test.mjs › #3163.d0eabe65 on that same clone and commit, node scripts/proof.mjs guard prints the same verdict lines as before the change, ignoring the proof: wall time line, and exits with the same code: deleted (criterion #3163.d0eabe65), by approved proposal (commit 018f61ab3e4c)',
  "PASS guard: scripts/proof-approvals.mjs: the proof lanes' own code changed, by approved proposal (commit ab84620ff34d)",
  'PASS guard: 5 commits checked: no guarded edit lacks its own approved proposal',
];
const EXPECTED_STATUS = 0;
// Variables the proof scripts read that could change what the guard decides or how it runs (README).
const CLEARED = ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'DEEP_PROOF_ISSUES', 'DEEP_GATES', 'DEEP_THROTTLE', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_APPROVERS', 'DEEP_PERF_LOCK', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'DEEP_PROOF_VITEST_REPORT'];

const load = () => loadavg().map((value) => value.toFixed(2)).join(' ');
const box = { children: [] };
console.log(`[3179] program under test: ${PROGRAM}; node ${process.version}; load (1/5/15 min) at suite start ${load()}`);

before(async () => {
  assert.ok(existsSync(join(PROGRAM, 'scripts/proof.mjs')) && existsSync(join(PROGRAM, 'package.json')), `setup: ${PROGRAM} holds no scripts/proof.mjs and package.json`);
  box.dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3179-')));
  box.clone = join(box.dir, 'deepbuild');
  const quiet = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 };
  const git = (...args) => execFileSync('/usr/bin/git', args, { ...quiet, cwd: box.clone });
  execFileSync('/usr/bin/git', ['clone', '-q', REPO, box.clone], quiet);
  git('fetch', '-q', 'origin', 'pull/3177/head');
  const head = git('rev-parse', 'FETCH_HEAD').trim();
  assert.ok(head.startsWith(HEAD), `setup: PR #3177's head is ${head}, not ${HEAD}`);
  git('checkout', '-q', '--detach', head);
  const main = git('rev-parse', '--verify', `${MAIN}^{commit}`).trim();
  git('update-ref', 'refs/remotes/origin/main', main);
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  assert.ok(base.startsWith(MAIN), `setup: PR #3177's head has merge base ${base} with the pinned origin/main, not ${MAIN}`);
  const bin = dirname(process.execPath);
  execFileSync(join(bin, 'npm'), ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { ...quiet, cwd: box.clone, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(git('status', '--porcelain').trim(), '', 'setup: the clone is not clean after npm ci');
  // The program under test's proof scripts, byte for byte, outside the judged clone and beside its node_modules
  // (they import typescript), so running them is no change of that clone.
  box.runner = join(box.dir, 'program');
  cpSync(join(PROGRAM, 'scripts'), join(box.runner, 'scripts'), { recursive: true, filter: (path) => !path.split('/').includes('node_modules') });
  cpSync(join(PROGRAM, 'package.json'), join(box.runner, 'package.json'));
  symlinkSync(join(box.clone, 'node_modules'), join(box.runner, 'node_modules'));
  box.run = await guard();
});

after(() => {
  // Only the processes this suite started, by their process group's PID.
  for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  if (box.dir) rmSync(box.dir, { recursive: true, force: true });
  console.log(`[3179] load (1/5/15 min) at suite end ${load()}`);
});

/** Runs the guard once in the clone, to its end or the cap. Resolves with its output, git count, wall and load. */
function guard() {
  const count = join(box.dir, 'git-count');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  for (const key of CLEARED) delete env[key];
  Object.assign(env, { NODE_OPTIONS: `--require=${join(HERE, 'count-git.cjs')}`, DEEP_3179_COUNT: count });
  const loadStart = load();
  const started = Date.now();
  const child = spawn(process.execPath, [join(box.runner, 'scripts/proof.mjs'), 'guard'], { cwd: box.clone, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '', capped = false;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => {
    capped = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, VERDICT_CAP_MS);
  const gits = () => (existsSync(count) ? readFileSync(count, 'utf8').split('\n').filter(Boolean) : []);
  return new Promise((done) => child.on('close', (status, signal) => {
    clearTimeout(timer);
    const wall = Date.now() - started;
    const lines = gits();
    const kinds = new Map();
    for (const line of lines) {
      const kind = line.split(' ').slice(1, 4).join(' ');
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    const top = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([kind, n]) => `${n} ${kind}`).join('; ');
    const run = { status, signal, stdout, stderr, capped, wall, gits: lines.length, loadStart, loadEnd: load() };
    run.summary = `exit ${status}${signal ? ` (${signal})` : ''}${capped ? `; killed by the suite at its ${VERDICT_CAP_MS / 60_000}-minute cap` : ''}\nwall ${(wall / 1000).toFixed(1)} s; git processes started ${run.gits} (${top}); load (1/5/15 min) at start ${loadStart}, at end ${run.loadEnd}`;
    run.all = `${run.summary}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    console.log(`[3179 guard] ${run.all}`);
    done(run);
  }));
}

test("#3179.381b8671 on PR #3177's branch in a fresh GitHub clone with origin/main pinned to its merge base, node scripts/proof.mjs guard finishes in under 60 s wall, with the load at start and end recorded, and starts no more than 200 git processes", () => {
  const run = box.run;
  assert.ok(run.gits >= 1, `setup: the preload counted no git process at all, so it counts nothing\n${run.summary}`);
  assert.ok(run.wall < WALL_LIMIT_MS && run.gits <= GIT_LIMIT, `the guard took ${(run.wall / 1000).toFixed(1)} s wall (limit under 60 s) and started ${run.gits} git processes (limit 200)\n${run.summary}`);
  assert.equal(run.capped, false, `the guard did not finish\n${run.summary}`);
});

test('#3179.2db877e7 on that same clone and commit, node scripts/proof.mjs guard prints the same verdict lines as before the change, ignoring the proof: wall time line, and exits with the same code', () => {
  const run = box.run;
  assert.equal(run.capped, false, `the guard printed no verdict to compare: it did not finish within the suite's cap\n${run.all}`);
  const lines = run.stdout.split('\n').filter((line) => !line.startsWith('proof: wall time')).filter((line) => VERDICT.test(line));
  assert.deepEqual(lines, EXPECTED, `the guard's verdict lines differ from before the change\n${run.all}`);
  assert.equal(run.status, EXPECTED_STATUS, `the guard's exit code differs from before the change (${EXPECTED_STATUS})\n${run.all}`);
});

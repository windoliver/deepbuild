// #3163: on PR #3093's branch, `node scripts/proof.mjs guard` finishes in under 60 s and starts no more than 200 git
// processes, and prints the verdict lines and exit code it printed before the change. Reached by running this
// checkout's `scripts/proof.mjs guard` in a fresh GitHub clone checked out at that PR's head (README).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const REPO = 'https://github.com/windoliver/deepbuild.git';
const HEAD = 'd00a540486292dfe02c5d53d3ff0d6f5d4fb9821'; // PR #3093's head, d00a54048
const BASE = '11eb8c6fd'; // its merge base with main
const WALL_LIMIT_MS = 60_000;
const GIT_LIMIT = 200;
// Criterion 2 doesn't bound the time; this cap only keeps the test's own wait bounded (README).
const VERDICT_CAP_MS = 4 * 60_000;
const VERDICT = /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) |^ {2}Fix: /;
const EXPECTED = ['PASS guard: 2 commits checked: no guarded edit lacks its own approved proposal'];

// The preload: every git process a node process of the run starts through child_process, sync or not, appends one
// line to $DEEP_3163_COUNT. Inherited through NODE_OPTIONS, so node processes the guard starts count theirs too. One
// call that reaches another wrapped one (execFileSync calling spawnSync) counts once.
const PRELOAD = `'use strict';
const childProcess = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { basename } = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const out = process.env.DEEP_3163_COUNT;
let depth = 0;
const isGit = (name, args) => {
  if (typeof name !== 'string') return false;
  if (name === 'git' || basename(name) === 'git') return true;
  return args === 'shell' && /^\\s*(?:\\S*\\/)?git(?:\\s|$)/.test(name);
};
for (const [method, shell] of [['spawn'], ['spawnSync'], ['execFile'], ['execFileSync'], ['exec', true], ['execSync', true]]) {
  const original = childProcess[method];
  childProcess[method] = function (name, ...rest) {
    if (depth === 0 && isGit(name, shell ? 'shell' : rest[0])) appendFileSync(out, method + ' ' + String(name) + ' ' + (Array.isArray(rest[0]) ? rest[0].slice(0, 3).join(' ') : '') + '\\n');
    depth += 1;
    try { return original.call(this, name, ...rest); } finally { depth -= 1; }
  };
}
syncBuiltinESMExports();
`;

const load = () => loadavg().map((value) => value.toFixed(2)).join(' ');
const box = {};

before(async () => {
  box.dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3163-')));
  box.clone = join(box.dir, 'deepbuild');
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: box.clone, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 });
  execFileSync('/usr/bin/git', ['clone', '-q', REPO, box.clone], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('fetch', '-q', 'origin', 'pull/3093/head', HEAD, '+refs/heads/main:refs/remotes/origin/main');
  git('checkout', '-q', '--detach', HEAD);
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  assert.ok(base.startsWith(BASE), `setup: PR #3093's head ${HEAD.slice(0, 9)} has merge base ${base} with origin/main, not ${BASE}`);
  execFileSync(join(dirname(process.execPath), 'npm'), ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: box.clone, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` } });
  assert.equal(git('status', '--porcelain').trim(), '', 'setup: the clone is not clean after npm ci');
  // This checkout's proof scripts, byte for byte, beside the clone's node_modules (they import typescript).
  box.runner = join(box.dir, 'runner');
  cpSync(join(CHECKOUT, 'scripts'), join(box.runner, 'scripts'), { recursive: true, filter: (path) => !path.split('/').includes('node_modules') });
  cpSync(join(CHECKOUT, 'package.json'), join(box.runner, 'package.json'));
  symlinkSync(join(box.clone, 'node_modules'), join(box.runner, 'node_modules'));
  box.preload = join(box.dir, 'count-git.cjs');
  writeFileSync(box.preload, PRELOAD);
  box.children = [];
});

after(() => {
  // Only the processes this suite started, by their process group's PID.
  for (const child of box.children ?? []) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  if (box.dir) rmSync(box.dir, { recursive: true, force: true });
});

/** Runs the guard in the clone; stops it once `stop` says why. Resolves with its output, git count, wall and load. */
function guard(name, stop) {
  const count = join(box.dir, `${name}.git-count`);
  writeFileSync(count, '');
  const env = { ...process.env, NODE_OPTIONS: `--require=${box.preload}`, DEEP_3163_COUNT: count };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  for (const key of ['NODE_TEST_CONTEXT', 'DEEP_PROOF_ISSUES', 'DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_BIN_DIR']) delete env[key];
  const loadStart = load();
  const started = Date.now();
  const child = spawn(process.execPath, [join(box.runner, 'scripts/proof.mjs'), 'guard'], { cwd: box.clone, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '', stopped = null;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const gits = () => readFileSync(count, 'utf8').split('\n').filter(Boolean).length;
  const watch = setInterval(() => {
    const why = stop(Date.now() - started, gits());
    if (why && !stopped) {
      stopped = why;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  }, 100);
  return new Promise((resolve) => child.on('close', (status, signal) => {
    clearInterval(watch);
    const wall = Date.now() - started;
    const result = { status, signal, stdout, stderr, stopped, wall, gits: gits(), loadStart, loadEnd: load() };
    result.all = `exit ${status}${signal ? ` (${signal})` : ''}${stopped ? `; stopped by the test: ${stopped}` : ''}\nwall ${(wall / 1000).toFixed(1)} s; git processes started ${result.gits}; load (1/5/15 min) at start ${loadStart}, at end ${result.loadEnd}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    console.log(`[${name}] ${result.all.split('\nstdout:')[0]}`);
    resolve(result);
  }));
}

test("#3163.9c395067 on PR #3093's branch in a fresh GitHub clone, node scripts/proof.mjs guard finishes in under 60 s wall, with the load at start and end recorded, and starts no more than 200 git processes", async () => {
  const run = await guard('limits', (wall, gits) => (gits > GIT_LIMIT ? `it started more than ${GIT_LIMIT} git processes (${gits}) after ${(wall / 1000).toFixed(1)} s` : wall >= WALL_LIMIT_MS ? `it ran 60 s without finishing, having started ${gits} git processes` : null));
  assert.ok(run.gits <= GIT_LIMIT, `the guard started more than ${GIT_LIMIT} git processes\n${run.all}`);
  assert.equal(run.stopped, null, `the guard did not finish in under 60 s wall\n${run.all}`);
  assert.ok(run.wall < WALL_LIMIT_MS, `the guard did not finish in under 60 s wall\n${run.all}`);
  assert.ok(run.gits >= 1, `setup: the preload counted no git process at all, so it counts nothing\n${run.all}`);
});

test('#3163.d0eabe65 on that same clone and commit, node scripts/proof.mjs guard prints the same verdict lines as before the change, ignoring the proof: wall time line, and exits with the same code', async () => {
  const run = await guard('verdict', (wall) => (wall >= VERDICT_CAP_MS ? `it ran ${VERDICT_CAP_MS / 60_000} minutes, the test's own cap, without finishing` : null));
  assert.equal(run.stopped, null, `the guard printed no verdict to compare: it did not finish within the test's cap\n${run.all}`);
  const lines = run.stdout.split('\n').filter((line) => !line.startsWith('proof: wall time')).filter((line) => VERDICT.test(line));
  assert.deepEqual(lines, EXPECTED, `the guard's verdict lines differ from before the change\n${run.all}`);
  assert.equal(run.status, 0, `the guard's exit code differs from before the change (0)\n${run.all}`);
});

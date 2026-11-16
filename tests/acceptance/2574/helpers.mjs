// Helpers for #2574's AC2 acceptance tests (grant.test.mjs). They reuse #1115's sandbox (a HOME of its own, so the
// throttle table and its log are the sandbox's ~/.deepbuild/throttle/, never the machine's) and its holders, and build
// a scratch tree as #1115's tree() does, with one change: every job the run can start (each lint script, the package
// build, each test file) is a probe that notes when it started and the DEEP_THROTTLE it ran under. Nothing here imports
// the code under test; this checkout's real scripts/affected.mjs and scripts/throttle.mjs run in the tree.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { CHECKOUT, gitIn, hold, lanesLists, started, until, write } from '../1115/helpers.mjs';

export { dump, LONG, sandbox, stop, summary, timedPath, until } from '../1115/helpers.mjs';

// docs/parallel-proof.md, section 6: the test class has 2 slots on the Mac, 4 on the Spark (Linux).
export const LIMIT = process.platform === 'darwin' ? 2 : 4;

const probe = (job) => `import { appendFileSync } from 'node:fs';
if (process.env.T2574_PROBE) appendFileSync(process.env.T2574_PROBE, JSON.stringify({ job: ${JSON.stringify(job)}, at: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
`;
/** A vitest test file that notes its start, then passes. */
export const vitestProbe = (file) => `import { test, expect } from 'vitest';\n${probe(file)}test('a probe passes', () => { expect(1).toBe(1); });\n`;
/** A node --test file that notes its start, then passes. */
export const nodeProbe = (file) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n${probe(file)}test('a probe passes', () => { assert.equal(1, 1); });\n`;

// The real throttle.mjs behind a recording shim: each CLI call notes its arguments and the pid of the real throttle
// process, the pid its log events carry. With T2574_SHRINK a `test --wait` wait is 0.02 min (1.2 s), as #1115's shim
// has it; with T2574_IDLE the real throttle reads a load of 0, so a top-level timed request doesn't wait on this busy
// machine's load (a boundary this repo doesn't own; the sandbox's table has no neighbour then).
const THROTTLE_SHIM = `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export * from './throttle-real.mjs';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const asked = [...args];
  const wait = args.indexOf('--wait');
  if (process.env.T2574_SHRINK && args[0] === 'test' && wait >= 0) args[wait + 1] = '0.02';
  const idle = 'import os from "node:os"; import { syncBuiltinESMExports } from "node:module"; os.loadavg = () => [0, 0, 0]; syncBuiltinESMExports();';
  const pre = process.env.T2574_IDLE ? ['--import', 'data:text/javascript,' + encodeURIComponent(idle)] : [];
  const result = spawnSync(process.execPath, [...pre, fileURLToPath(new URL('./throttle-real.mjs', import.meta.url)), ...args], { stdio: 'inherit' });
  if (process.env.T2574_CALLS) appendFileSync(process.env.T2574_CALLS, JSON.stringify({ args: asked, pid: result.pid }) + '\\n');
  process.exit(result.status ?? 1);
}
`;

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'packages/**/test/**/*.test.ts', 'packages/**/*.test.ts'] } });
`;
const CARGO = `#!/bin/sh
if [ "$1" = metadata ]; then echo '{"packages":[],"workspace_members":[],"version":1}'; exit 0; fi
exit 0
`;

export const VITEST = 'tests/fixture-2574/probe.test.ts';
export const NODE = 'tests/fixture-2574-probe.test.mjs';
export const SRC = 'packages/p/src/index.mjs';

/**
 * A scratch tree: this checkout's scripts/ with each lint script a probe and throttle.mjs behind the shim, a
 * workspace package `packages/p` whose build is a probe, a vitest and a node --test probe, and `files`; committed in a
 * fresh repository, with a cargo stub on PATH. Its env points the probes, the shim's record and TMPDIR into box.dir.
 */
export function tree(box, files = {}, name = 'tree') {
  const cwd = join(box.dir, name);
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  for (const script of lanesLists(cwd).lint) writeFileSync(join(cwd, script), probe(`lint ${script}`));
  writeFileSync(join(cwd, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`);
  renameSync(join(cwd, 'scripts/throttle.mjs'), join(cwd, 'scripts/throttle-real.mjs'));
  writeFileSync(join(cwd, 'scripts/throttle.mjs'), THROTTLE_SHIM);
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  write(cwd, {
    '.gitignore': 'node_modules\n',
    'vitest.config.mjs': VITEST_CONFIG,
    'package.json': `${JSON.stringify({ name: 'fixture-2574', private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
    'packages/p/package.json': `${JSON.stringify({ name: '@fixture/p', version: '0.0.0', private: true, scripts: { build: 'node ../../build-probe.mjs' } }, null, 2)}\n`,
    [SRC]: 'export const value = 1;\n',
    'build-probe.mjs': probe('build'),
    [VITEST]: vitestProbe(VITEST),
    [NODE]: nodeProbe(NODE),
    ...files,
  });
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, `bin-${name}`);
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), CARGO);
  chmodSync(join(bin, 'cargo'), 0o755);
  const tmp = join(box.dir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const env = { PATH: `${bin}${delimiter}${box.env.PATH}`, TMPDIR: tmp, T2574_PROBE: join(box.dir, 'probes.jsonl'), T2574_CALLS: join(box.dir, 'calls.jsonl') };
  return { cwd, env, tmp };
}

const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
/** The jobs that started, by their probes. */
export const probes = (fixture) => lines(fixture.env.T2574_PROBE);
/** The shim's record of each throttle.mjs CLI call in the tree. */
export const calls = (fixture) => lines(fixture.env.T2574_CALLS);
/** The sandbox's throttle log, ~/.deepbuild/throttle/log, in order. */
export const throttleLog = (box) => lines(join(box.home, '.deepbuild', 'throttle', 'log'));
/** The job logs affected.mjs opened in its logs folder under the run's TMPDIR (deep-affected-*, as the issue names). */
export function jobLogs(fixture) {
  return readdirSync(fixture.tmp).filter((name) => name.startsWith('deep-affected-')).flatMap((dir) => readdirSync(join(fixture.tmp, dir)).filter((name) => name.endsWith('.log')).map((name) => `${dir}/${name}`));
}

/** `node scripts/affected.mjs ...args` in the tree, in its own process group; out() reads its output so far. */
export function start(box, { cwd, env }, args, extra = {}) {
  const child = spawn(process.execPath, ['scripts/affected.mjs', ...args], { cwd, env: { ...box.env, ...env, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.out = () => stdout;
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  return child;
}

/** Fills every test slot of the sandbox's table with other sessions' holders; resolves with them once all hold. */
export async function fill(box, ms) {
  const holders = Array.from({ length: LIMIT }, (_, index) => hold(box, 'test', `neighbour-${index}`, ms));
  assert.ok(await until(() => started(box) === LIMIT, 60_000), `the neighbours did not take all ${LIMIT} test grants`);
  return holders;
}

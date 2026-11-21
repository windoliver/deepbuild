// Helpers for #2627's second criterion: a sandbox with its own HOME and throttle table (so the machine's
// ~/.deepbuild/throttle/ is never read or written), the scratch tree this checkout's real scripts/affected.mjs runs in,
// a wall-clock limit on each run, and the process table. Nothing here imports the code under test: affected.mjs is
// reached by running it (README: The surface). Written here, never imported from another suite.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The bound the run is given, in minutes, through DEEP_JOB_IDLE_MIN (the issue's testable form). */
export const BOUND_MIN = 1;
/** The longest a run may take: the bound, the 10 s before the SIGKILL, and slack for vitest's start on a loaded machine. */
export const RUN_LIMIT_MS = 270_000;
/** Each test's own limit, above the run's, so a run that hangs fails at RUN_LIMIT_MS with its output. */
export const TEST = { timeout: 330_000 };

const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR',
  'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_TEST_GRANT_WAIT', 'DEEP_SHARDS', 'DEEP_JOB_IDLE_MIN', 'CARGO_MAKEFLAGS'];

/**
 * A sandbox removed after the test: a HOME, a throttle table folder (DEEP_THROTTLE_TABLE), a TMPDIR for the run's logs
 * and a file the fixtures note their processes in. After the test, every process group it started and every process a
 * fixture noted (by PID, when its start time still matches) is stopped; nothing is killed by name or port.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2627-')));
  const home = join(dir, 'home'), table = join(dir, 'table'), tmp = join(dir, 'tmp');
  for (const folder of [home, table, tmp]) mkdirSync(folder);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), DEEP_THROTTLE_TABLE: table, TMPDIR: tmp };
  for (const name of ENV_OUT) delete env[name];
  const box = { dir, home, table, tmp, env, pids: join(dir, 'pids.jsonl'), groups: [] };
  t.after(() => {
    for (const pgid of box.groups) try { process.kill(-pgid, 'SIGKILL'); } catch {}
    for (const { pid, start } of noted(box)) if (alive(pid, start)) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** A line a fixture runs to note a process: its role, PID and start time, as `ps -o lstart=` reads it. */
const NOTE = (pids) => `const note = (role, pid) => appendFileSync(${JSON.stringify(pids)}, JSON.stringify({ role, pid, start: execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() }) + '\\n');`;
// A child the stuck file starts and never waits for: it ignores SIGTERM, so only a SIGKILL ends it.
const CHILD = `spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], { stdio: 'ignore' })`;

/** A node --test file that never exits: its one test never settles, and it has started a child that ignores SIGTERM. */
export const nodeStuck = (box) => `import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import test from 'node:test';
${NOTE(box.pids)}
test('it never ends', () => new Promise(() => {
  const child = ${CHILD};
  note('file', process.pid);
  note('child', child.pid);
  setInterval(() => {}, 1000);
}));
`;
export const nodePass = `import assert from 'node:assert/strict';
import test from 'node:test';
test('it passes', () => { assert.equal(1, 1); });
`;
/** A vitest file whose worker spins without yielding, so vitest's own test timeout can't fire; it started a child too. */
export const vitestStuck = (box) => `import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { test } from 'vitest';
${NOTE(box.pids)}
test('it spins without yielding', () => {
  const child = ${CHILD};
  note('file', process.pid);
  note('child', child.pid);
  for (;;) {}
});
`;
export const vitestPass = `import { expect, test } from 'vitest';
test('it passes', () => { expect(1).toBe(1); });
`;

// cargo is a stub: `metadata` reports no crates. The selection holds no crate, so nothing else calls it.
const CARGO = `#!/bin/sh
if [ "$1" = metadata ]; then echo '{"packages":[],"workspace_members":[],"version":1}'; exit 0; fi
exit 0
`;
// The repo's include written out: its own config imports lanes.mjs, which needs the workspace packages built.
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
`;

/**
 * The scratch tree: a copy of this checkout's scripts/ with the lint lane's own scripts stubbed, an empty
 * known-failures baseline, a vitest config, a folder of links to node_modules (so vitest's cache lands here) and
 * `files`, committed in a fresh repository, with a cargo stub first on PATH.
 */
export function tree(box, files) {
  const cwd = join(box.dir, 'tree');
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  const lanes = execFileSync(process.execPath, ['--input-type=module', '-e', `const { checks } = await import('./scripts/lanes.mjs');
    console.log(JSON.stringify(checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''))));`], { cwd, encoding: 'utf8' });
  for (const script of JSON.parse(lanes.trim().split('\n').at(-1))) writeFileSync(join(cwd, script), '// a lint stub for #2627\n');
  writeFileSync(join(cwd, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`);
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  for (const [path, content] of Object.entries({ '.gitignore': 'node_modules\n', 'vitest.config.mjs': VITEST_CONFIG, ...files })) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), CARGO);
  chmodSync(join(bin, 'cargo'), 0o755);
  return { cwd, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/**
 * `node scripts/affected.mjs ...paths` in the tree, in a process group of its own, with DEEP_JOB_IDLE_MIN at the bound.
 * Resolves with its status, output and time taken once it exits, or, at RUN_LIMIT_MS, SIGKILLs its whole group and
 * resolves with `limited: true`, so a run nothing bounds fails at its limit, never hangs.
 */
export function affected(box, { cwd, env }, paths) {
  const began = Date.now();
  const child = spawn(process.execPath, ['scripts/affected.mjs', ...paths], { cwd, env: { ...box.env, ...env, DEEP_JOB_IDLE_MIN: String(BOUND_MIN) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.groups.push(child.pid);
  let stdout = '', stderr = '', limited = false;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => {
    limited = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, RUN_LIMIT_MS);
  // Its end is its exit: a process it left running may hold the pipes open, so their close waits at most 1 s.
  const closed = new Promise((resolve) => child.on('close', resolve));
  return new Promise((resolve) => child.on('exit', (status, signal) => {
    clearTimeout(timer);
    const ms = Date.now() - began;
    Promise.race([closed, pause(1_000)]).then(() => resolve({ status, signal, stdout, stderr, ms, limited }));
  }));
}

export const pause = (ms) => new Promise((done) => setTimeout(done, ms));
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await pause(100);
  }
}

/** The processes the fixtures noted: { role, pid, start }. */
export const noted = (box) => (existsSync(box.pids) ? readFileSync(box.pids, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

/** Whether the process `pid` that started at `start` still runs, read from the process table (a zombie runs nothing). */
export function alive(pid, start) {
  let row;
  try {
    row = execFileSync('ps', ['-o', 'stat=', '-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return false;
  }
  const [stat, ...rest] = row.split(/\s+/);
  return rest.join(' ') === start.split(/\s+/).join(' ') && !stat.startsWith('Z');
}

/** The sandbox's throttle log, <table>/log, one JSON object per line. */
export function throttleLog(box) {
  const file = join(box.table, 'log');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { unparsed: line }; } }) : [];
}
/** The sandbox's throttle table, <table>/table.json, as its last writer left it. */
export function throttleTable(box) {
  const file = join(box.table, 'table.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { grants: [], requests: [] };
}

/** The summary line affected.mjs ends on: `<STATE> affected: ...`. */
export const summary = (stdout) => stdout.split('\n').filter((line) => / affected: /.test(line)).at(-1) ?? '';
/** The lines starting with a state word that name `file`. */
export const stateLines = (stdout, file) => stdout.split('\n').filter((line) => /^(?:PASS|FAIL|NEW FAIL|KNOWN|BLOCKED|INCONCLUSIVE|INVALID|NO NEW FAILURES)\b/.test(line) && line.includes(file));

const tail = (text, size = 3_000) => (text.length > size ? `…${text.slice(-size)}` : text);
export const dump = (box, run) => [
  `affected.mjs: ${run.limited ? `still running at its ${RUN_LIMIT_MS / 1000} s limit, so its process group was SIGKILLed` : `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}`} after ${(run.ms / 1000).toFixed(0)} s`,
  `stdout:\n${tail(run.stdout)}`,
  `stderr:\n${tail(run.stderr, 1_000)}`,
  `noted processes:\n${noted(box).map((entry) => JSON.stringify(entry)).join('\n')}`,
  `throttle log:\n${throttleLog(box).map((entry) => JSON.stringify(entry)).join('\n')}`,
].join('\n');

/**
 * What the criterion holds of a run with one stuck file and one passing file in the same job (README: Criteria to
 * tests): it ended within its limit, and not before the bound; the stuck file reads INCONCLUSIVE naming the bound, never
 * FAIL or PASS; the passing file keeps its pass; the summary and exit read INCONCLUSIVE; no process of the stuck file is
 * left; the run's grant is released and gone from the table.
 */
export async function expectBounded(box, run, { stuck, pass }) {
  const all = () => dump(box, run);
  assert.ok(!run.limited, `affected.mjs did not end within ${RUN_LIMIT_MS / 1000} s with DEEP_JOB_IDLE_MIN=${BOUND_MIN}: nothing bounded the job holding ${stuck}\n${all()}`);
  const roles = noted(box).map(({ role }) => role);
  assert.ok(roles.includes('file') && roles.includes('child'), `the stuck file never ran far enough to note its process and child, so this run proves nothing\n${all()}`);
  assert.ok(run.ms >= BOUND_MIN * 60_000, `the run ended after ${(run.ms / 1000).toFixed(0)} s, before the job could have been idle for its ${BOUND_MIN} min bound\n${all()}`);

  const stuckLines = stateLines(run.stdout, stuck);
  assert.ok(stuckLines.some((line) => line.startsWith('INCONCLUSIVE')), `no INCONCLUSIVE line names ${stuck}\n${all()}`);
  assert.deepEqual(stuckLines.filter((line) => /^(?:PASS|FAIL|NEW FAIL|KNOWN|NO NEW FAILURES)\b/.test(line)), [], `${stuck} reads FAIL or PASS, not INCONCLUSIVE\n${all()}`);
  assert.ok(stuckLines.some((line) => line.startsWith('INCONCLUSIVE') && RegExp(`\\b${BOUND_MIN} ?min`).test(line)), `the INCONCLUSIVE line for ${stuck} doesn't name the ${BOUND_MIN} min bound\n${all()}`);

  assert.deepEqual(stateLines(run.stdout, pass), [], `the passing file beside it, ${pass}, lost its pass\n${all()}`);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: .*\b1 passed\b/, `the summary isn't INCONCLUSIVE with the passing file's one pass\n${all()}`);
  assert.equal(run.status, 2, `the run exited ${run.status}, not 2 (INCONCLUSIVE)\n${all()}`);

  const left = () => noted(box).filter(({ pid, start }) => alive(pid, start));
  await until(() => !left().length, 5_000);
  assert.deepEqual(left(), [], `processes of the stuck file still run after the run ended\n${all()}`);

  const log = throttleLog(box);
  const grants = log.filter((entry) => entry.event === 'granted' && entry.class === 'test' && entry.grant === 'top-level');
  assert.equal(grants.length, 1, `the run took ${grants.length} top-level test grants in the sandbox's table, not one\n${all()}`);
  const [{ id }] = grants;
  assert.ok(log.some((entry) => entry.event === 'released' && entry.id === id), `the log has no released entry for the run's grant ${id}\n${all()}`);
  assert.deepEqual(throttleTable(box).grants, [], `the throttle table still holds grants after the run\n${all()}`);
}

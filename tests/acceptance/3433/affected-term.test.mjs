import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { alive, CHECKOUT, commandOf, fixtureScripts, git, HANGS, ownEnv, recorded, sandbox, startOf, TEST_FILE, treeOf, until } from './helpers.mjs';

function affectedFixture(box, body) {
  const repo = join(box.dir, 'repo'), home = join(box.dir, 'home'), table = join(box.dir, 'table'), tmp = join(box.dir, 'tmp'), bin = join(box.dir, 'bin'), pids = join(box.dir, 'pids');
  for (const folder of [repo, home, table, tmp, bin, join(repo, 'tests')]) mkdirSync(folder, { recursive: true });
  const { grandchild } = fixtureScripts(box.dir);
  cpSync(join(CHECKOUT, 'scripts'), join(repo, 'scripts'), { recursive: true });
  symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  writeFileSync(join(repo, '.gitignore'), 'scripts/\nnode_modules\n');
  writeFileSync(join(repo, 'Cargo.toml'), '[workspace]\nmembers = []\nresolver = "2"\n');
  writeFileSync(join(repo, TEST_FILE), `import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import test from 'node:test';
const pids = ${JSON.stringify(pids)}, grandchild = ${JSON.stringify(grandchild)};
${body}
`);
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[]}\'; exit 0; fi\necho "fixture cargo: only metadata" >&2\nexit 1\n');
  chmodSync(join(bin, 'cargo'), 0o755);
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'the tree the run proves');
  return { repo, home, table, tmp, bin, pids };
}

test('#3433.7e03e656 an affected.mjs run stopped by SIGTERM to the affected.mjs process alone, while a job\'s command has started a grandchild in a process group of its own, prints BLOCKED affected: stopped by SIGTERM and leaves no process the job started alive 15 s later', { timeout: 360_000 }, async (t) => {
  const box = sandbox(t, 'affected-term');
  const fixture = affectedFixture(box, HANGS);
  const env = ownEnv({
    HOME: fixture.home,
    TMPDIR: fixture.tmp,
    DEEP_THROTTLE_TABLE: fixture.table,
    DEEP_LEASE_WAIT: '1',
    DEEP_TEST_GRANT_WAIT: '1',
    PATH: [fixture.bin, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  });
  for (const key of ['DEEP_AFFECTED_HELD', 'DEEP_THROTTLE_RUN', 'DEEP_AFFECTED_MIN', 'DEEP_JOB_IDLE_MIN', 'DEEP_SHARDS']) delete env[key];
  const child = spawn(process.execPath, ['scripts/affected.mjs', TEST_FILE], { cwd: fixture.repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { output: '', exit: null };
  child.stdout.on('data', (chunk) => { run.output += chunk; });
  child.stderr.on('data', (chunk) => { run.output += chunk; });
  child.on('exit', (code, signal) => { run.exit = { code, signal }; });
  if (child.pid > 1) box.seen.push({ role: 'affected', pid: child.pid, start: startOf(child.pid) });
  const tree = [];
  // deadline: spaces the test's own listings of the run's tree; it ends with the run, or with the test.
  const watch = setInterval(() => {
    if (run.exit !== null) return;
    for (const proc of treeOf(child.pid)) if (proc.pid > 1 && !tree.some((seen) => seen.pid === proc.pid && seen.start === proc.start)) {
      const entry = { role: 'tree', ...proc };
      tree.push(entry);
      box.seen.push(entry);
    }
  }, 200);
  t.after(() => clearInterval(watch));
  const job = () => recorded(box, fixture.pids).filter(({ role }) => ['runner', 'file', 'grandchild'].includes(role));
  const all = () => `exit: ${JSON.stringify(run.exit)}\noutput:\n${run.output}\nprocesses the job started: ${JSON.stringify(job().map((proc) => ({ ...proc, alive: alive(proc), command: alive(proc) ? commandOf(proc.pid) : undefined })))}`;

  // deadline: the run selects the file, takes its grant and starts the job; its lint jobs run beside it.
  const up = await until(() => job().some(({ role }) => role === 'grandchild') || run.exit !== null, 180_000);
  // deadline: the grandchild has run 6 s before the stop, as in the lane tests (README: Assumptions 4).
  await new Promise((done) => setTimeout(done, 6_000));
  const procs = job();
  assert.ok(up && run.exit === null && ['runner', 'file', 'grandchild'].every((role) => procs.some((proc) => proc.role === role && alive(proc))), `the job's node --test runner, its test file and the grandchild were running under the affected.mjs run before the stop\n${all()}`);

  const stoppedAt = Date.now();
  process.kill(child.pid, 'SIGTERM');
  // deadline: the criterion's window: 15 s after the stop no process the job started may still run.
  await until(() => !procs.some(alive), 15_000);
  const left = procs.filter(alive);
  assert.deepEqual(left.map(({ role, pid }) => `${role} ${pid}`), [], `15 s after SIGTERM to affected.mjs, processes its job started still run\n${all()}`);
  // deadline: the run is given 30 s from the stop to print its verdict and end.
  await until(() => run.exit !== null, Math.max(0, stoppedAt + 30_000 - Date.now()));
  clearInterval(watch);
  assert.match(run.output, /^BLOCKED affected: stopped by SIGTERM\b/m, `the stopped run printed BLOCKED affected: stopped by SIGTERM\n${all()}`);
});

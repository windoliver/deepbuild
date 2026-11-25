// #3433: perf's `BLOCKED perf` line for a copy's checks past their allowance names each process the stop ended, by
// PID and command. A fixture repository as tests/perf.test.mjs makes one (a merge base with budgets, the checkout's
// scripts copied in), whose copies' checks start a grandchild in a process group of their own and wait.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, fixtureScripts, git, GRANDCHILD, names, ownEnv, recorded, sandbox } from './helpers.mjs';

test('#3433.0ced7c1d perf\'s BLOCKED perf line for a copy\'s checks past their allowance names each process the stop ended, by PID and command', { timeout: 300_000 }, (t) => {
  const box = sandbox(t, 'perf');
  const repo = join(box.dir, 'repo'), cache = join(box.dir, 'cache'), home = join(box.dir, 'home'), table = join(box.dir, 'table'), pids = join(box.dir, 'pids');
  for (const folder of [repo, cache, home, table, join(repo, 'benchmarks')]) mkdirSync(folder, { recursive: true });
  const { grandchild } = fixtureScripts(box.dir);
  cpSync(join(CHECKOUT, 'scripts'), join(repo, 'scripts'), { recursive: true });
  // A copy's checks (any cwd but the checkout's) record their PID, start the grandchild in a group of its own, and wait.
  const checks = `import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
if (process.cwd() !== ${JSON.stringify(repo)}) {
  appendFileSync(${JSON.stringify(pids)}, \`lead \${process.pid}\\n\`);
  spawn(process.execPath, [${JSON.stringify(grandchild)}, ${JSON.stringify(pids)}], { detached: true, stdio: 'ignore' });
  await new Promise(() => setInterval(() => {}, 1000));
}
`;
  const files = {
    'scripts/checks.mjs': checks,
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: `node -e "require('node:fs').writeFileSync('warm', '')"` } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    // The allowance: 1000 ms and its margin, 1.5 s.
    'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 1000 }, initialReason: 'Fixture base.' }, tasks: [] }),
    '.gitignore': 'warm\nnode_modules/\n',
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content);
  git(repo, 'init', '-q');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

  const env = ownEnv({ HOME: home, XDG_CACHE_HOME: cache, DEEP_THROTTLE_TABLE: table });
  const perf = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })], { cwd: repo, encoding: 'utf8', env, timeout: 240_000 });
  const procs = recorded(box, pids);
  const output = `${perf.stdout}${perf.stderr}`;
  // The verdict: from `BLOCKED perf:` to its `Fix:` line.
  const verdict = output.match(/^BLOCKED perf: [\s\S]*?(?=^\s+Fix:)/m)?.[0];
  assert.ok(verdict && /ETIMEDOUT/.test(verdict), `perf printed a BLOCKED perf line for the copy's checks past their allowance, naming ETIMEDOUT\nstatus ${perf.status}\n${output}`);
  const byRole = Object.fromEntries(procs.map((proc) => [proc.role, proc]));
  assert.ok(byRole.lead && byRole.grandchild, `the copy's checks and their grandchild both started: ${JSON.stringify(procs)}\n${output}`);
  for (const [role, word] of [['lead', 'checks.mjs'], ['grandchild', GRANDCHILD]]) {
    assert.ok(names(verdict, byRole[role].pid, word), `perf's BLOCKED perf line names the ${role} the stop ended, pid ${byRole[role].pid} with its command (${word}), on one line:\n${verdict}`);
  }
});

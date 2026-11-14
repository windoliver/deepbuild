// #1123 regression: an independently detached build cannot outlive the bay's reuse barrier.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { machineRepo, sandbox, until, write } from './acceptance/1117/helpers.mjs';

const identity = (pid) => ({ pid, start: execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).trim() });
const CLAIM = `const { claimPair } = await import(process.argv[1]);
const pair = claimPair(process.cwd(), () => {});
if (pair.blocked || pair.refused) { console.log('BLOCKED ' + (pair.blocked || pair.refused)); process.exit(2); }
try { pair.use('change', 'reclaim'); console.log('READY'); } finally { pair.close(null, false); }`;

for (const mode of ['cleanup', 'dead-supervisor', 'live-owner', 'wrong-group-start', 'bad-record', 'scan-failed', 'timeout']) {
  test(`bay build barrier: ${mode}`, { timeout: 30_000 }, async (t) => {
    const box = sandbox(t), repo = machineRepo(box);
    // No package install or compiler is needed to observe a source/target reset.
    rmSync(join(repo.worktree, 'package-lock.json'));
    const bay = join(box.bays, '1/change'), record = join(bay, 'target/.deep-proof-builds/build.json');
    const cleaned = join(box.dir, 'cleaned'), ready = join(box.dir, 'supervisor-ready');
    write(bay, { 'source-before': 'old source', 'target/keep': 'old target', 'target/.deep-proof-builds/build.json': '{}' });
    const cargo = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    box.children.push(cargo);
    const group = identity(cargo.pid);
    const old = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    box.children.push(old);
    const dead = identity(old.pid);
    old.kill('SIGKILL');
    assert.ok(await until(() => old.signalCode !== null, 2000));
    const supervisor = spawn(process.execPath, ['--input-type=module', '-e', `
      import { existsSync, rmSync, writeFileSync } from 'node:fs';
      process.on('SIGTERM', () => { ${mode === 'timeout' ? '' : `setTimeout(() => {
        if (!existsSync(${JSON.stringify(join(bay, 'source-before'))}) || !existsSync(${JSON.stringify(join(bay, 'target/keep'))})) process.exit(9);
        process.kill(-${cargo.pid}, 'SIGKILL');
        writeFileSync(${JSON.stringify(cleaned)}, 'cleanup before reset');
        rmSync(${JSON.stringify(record)}, { force: true }); process.exit(0);
      }, 500);`} });
      writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);
    `], { detached: true, stdio: 'ignore' });
    box.children.push(supervisor);
    assert.ok(await until(() => existsSync(ready), 2000));
    const supervisorId = identity(supervisor.pid);
    const owner = mode === 'live-owner' ? identity(process.pid) : dead;
    writeFileSync(record, mode === 'bad-record' ? '{' : JSON.stringify({ owner, supervisor: ['dead-supervisor', 'wrong-group-start'].includes(mode) ? dead : supervisorId, group: { ...group, ...(mode === 'wrong-group-start' ? { start: 'not the recorded start' } : {}) } }));
    const env = { ...box.env };
    if (mode === 'scan-failed') {
      const shim = join(box.dir, 'shim'), ps = execFileSync('which', ['ps'], { encoding: 'utf8' }).trim();
      write(shim, { ps: `#!/bin/sh\ncase "$*" in *pgid*) exit 1;; esac\nexec "${ps}" "$@"\n` });
      chmodSync(join(shim, 'ps'), 0o755);
      env.PATH = `${shim}:${env.PATH}`;
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', CLAIM, pathToFileURL(repo.bays).href], { cwd: repo.worktree, env, encoding: 'utf8', timeout: 15_000 });
    if (['cleanup', 'dead-supervisor'].includes(mode)) {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /READY/);
      assert.ok(!existsSync(join(bay, 'source-before')), 'claim did not actually replace the bay');
      assert.ok(await until(() => cargo.signalCode !== null, 2000), 'detached compiler survived bay reuse');
      if (mode === 'cleanup') assert.equal(readFileSync(cleaned, 'utf8'), 'cleanup before reset');
    } else {
      assert.equal(result.status, 2, `unsafe bay reuse for ${mode}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /BLOCKED/);
      assert.equal(readFileSync(join(bay, 'source-before'), 'utf8'), 'old source');
      assert.equal(readFileSync(join(bay, 'target/keep'), 'utf8'), 'old target');
      assert.ok(existsSync(record), 'unproven cleanup discarded its record');
      process.kill(cargo.pid, 0);
    }
  });
}

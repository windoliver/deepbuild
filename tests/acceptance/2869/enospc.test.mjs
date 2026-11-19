// Acceptance test for #2869: a throttle waiter whose table write fails with ENOSPC keeps waiting and its place, and is
// granted and runs its command once space and a slot are back; it reads INCONCLUSIVE only when its --wait runs out; its
// failed write leaves no temp file of its own; any other error still ends it BLOCKED. Driven through the CLI,
// `throttle.mjs <class> --wait <min> -- <command>`, on a table of the test's own (DEEP_THROTTLE_TABLE, read inside a
// test run; docs/parallel-proof.md section 6).
//
// A full disk without root: the waiter's own temp table file, `table.json.<pid>` (the temp file locked() writes and
// renames into place), is made a symlink to /dev/full, so the waiter's table write fails with ENOSPC while every other
// process's writes go through. While "the disk is full" a helper process plants the symlink again whenever it is gone.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const throttle = fileURLToPath(new URL('../../../scripts/throttle.mjs', import.meta.url));
// build has two slots on Linux (scripts/throttle.mjs LIMITS); every case first fills them with holders of its own.
const SLOTS = 2;

// Where the platform can't make a write fail with ENOSPC this way, nothing is proven: skipped, never passed.
const noFull = (() => {
  if (process.platform !== 'linux') return `INCONCLUSIVE: ${process.platform} has no /dev/full to make a table write fail with ENOSPC`;
  try {
    writeFileSync('/dev/full', 'x');
    return 'INCONCLUSIVE: a write to /dev/full did not fail, so it can\'t stand in for a full disk';
  } catch (error) {
    return error.code === 'ENOSPC' ? false : `INCONCLUSIVE: a write to /dev/full failed with ${error.code}, not ENOSPC`;
  }
})();

const until = async (found, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await pause(100)) if (found()) return true;
  return found();
};
const present = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** A sandbox: its own table folder, and everything it starts stopped by PID and the folder removed afterwards. */
function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2869-')));
  const table = join(dir, 'table'), release = join(dir, 'release');
  mkdirSync(table);
  mkdirSync(join(dir, 'home'));
  const started = [];
  const env = { ...process.env, HOME: join(dir, 'home'), DEEP_THROTTLE_TABLE: table };
  for (const key of ['DEEP_THROTTLE', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT']) delete env[key];
  t.after(() => {
    writeFileSync(release, '');
    for (const child of started) if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const spawned = (args) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    started.push(child);
    const run = { child, pid: child.pid, out: '', status: null, ended: null };
    child.stdout.on('data', (chunk) => { run.out += chunk; });
    child.stderr.on('data', (chunk) => { run.out += chunk; });
    child.on('exit', (status, signal) => { run.status = status ?? `signal ${signal}`; run.ended = Date.now(); });
    return run;
  };
  const requests = () => {
    try {
      return JSON.parse(readFileSync(join(table, 'table.json'), 'utf8')).requests ?? [];
    } catch {
      return [];
    }
  };
  return {
    dir, table,
    /** Fills every build slot with a holder whose command runs until `release` is called. */
    async hold() {
      const holders = [];
      for (let k = 0; k < SLOTS; k++) {
        const up = join(dir, `holder-${k}.up`), gone = join(dir, `holder-${k}.release`);
        const stub = `const fs = require('fs'); const parent = process.ppid; fs.writeFileSync(${JSON.stringify(up)}, ''); setInterval(() => (fs.existsSync(${JSON.stringify(gone)}) || fs.existsSync(${JSON.stringify(release)}) || process.ppid !== parent) && process.exit(0), 100)`;
        const run = spawned([throttle, 'build', '--wait', '1', '--', process.execPath, '-e', stub]);
        assert.ok(await until(() => existsSync(up), 60_000), `holder ${k} got no build grant:\n${run.out}`);
        holders.push({ run, release: () => writeFileSync(gone, '') });
      }
      return holders;
    },
    /** A waiter for build whose command appends `name` to the sandbox's `ran` file. */
    async waiter(name, wait = 1) {
      const ran = join(dir, 'ran');
      const run = spawned([throttle, 'build', '--wait', String(wait), '--', process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(ran)}, ${JSON.stringify(`${name}\n`)})`]);
      assert.ok(await until(() => requests().some((request) => request.pid === run.pid) || run.status !== null, 60_000), `waiter ${name} never got in line:\n${run.out}`);
      assert.equal(run.status, null, `waiter ${name} ended before it waited:\n${run.out}`);
      return run;
    },
    ran: () => (existsSync(join(dir, 'ran')) ? readFileSync(join(dir, 'ran'), 'utf8') : ''),
    /** The temp table file only `pid` writes. */
    temp: (pid) => join(table, `table.json.${pid}`),
    /** A full disk for `pid`: its temp table file a symlink to /dev/full, planted again whenever it is gone, until stopped. */
    full(pid) {
      const at = join(table, `table.json.${pid}`);
      const planter = spawned(['-e', `const fs = require('fs'); const at = ${JSON.stringify(at)}; const parent = process.ppid; for (;;) { try { fs.symlinkSync('/dev/full', at); } catch {} if (process.ppid !== parent) process.exit(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); }`]);
      return {
        // Planted only as a symlink: a real file there is the waiter's own write, between its write and its rename.
        planted: () => {
          try {
            return lstatSync(at).isSymbolicLink();
          } catch {
            return false;
          }
        },
        // Space comes back: the planter is stopped, by its PID; a symlink it left is the next write's last ENOSPC.
        stop: async () => {
          planter.child.kill('SIGKILL');
          await until(() => planter.status !== null, 10_000);
        },
      };
    },
  };
}

test('a waiter whose table write fails with ENOSPC keeps waiting and its place, and is granted and runs its command once space and a slot are back', { skip: noFull }, async (t) => {
  const box = sandbox(t);
  const [first, second] = await box.hold();
  const a = await box.waiter('A');
  const b = await box.waiter('B');
  const disk = box.full(a.pid);
  assert.ok(await until(disk.planted, 10_000), 'the full disk could not be set up');
  // A slot comes back while the disk is still full: A's write can't land, so neither A nor B (behind A) is granted.
  first.release();
  await until(() => first.run.status !== null, 30_000);
  await pause(3_000);
  assert.equal(a.status, null, `the waiter ended while its table write failed with ENOSPC (exit ${a.status}):\n${a.out}`);
  assert.equal(box.ran(), '', `a command ran while the waiter's table write could not land, so its write never failed:\n${box.ran()}`);
  assert.equal(b.status, null, `the waiter behind it ended:\n${b.out}`);
  // Space comes back: A is granted first and runs its command once; B follows.
  await disk.stop();
  assert.ok(await until(() => a.status !== null, 60_000), `the waiter was never granted once space and a slot were back:\n${a.out}`);
  assert.equal(a.status, 0, `the waiter did not end with its command's status:\n${a.out}`);
  second.release();
  assert.ok(await until(() => b.status !== null, 60_000), `the waiter behind it was never granted:\n${b.out}`);
  assert.equal(b.status, 0, b.out);
  assert.equal(box.ran(), 'A\nB\n', 'the waiter lost its place, or its command did not run exactly once');
});

test('a waiter whose table write fails with ENOSPC until its --wait runs out reads INCONCLUSIVE no grant, only then', { skip: noFull }, async (t) => {
  const box = sandbox(t);
  await box.hold();
  const wait = 0.1;
  const a = await box.waiter('A', wait);
  const since = Date.now() - 1_000;
  const disk = box.full(a.pid);
  assert.ok(await until(disk.planted, 10_000), 'the full disk could not be set up');
  assert.ok(await until(() => a.status !== null, 60_000), `the waiter never ended though its ${wait} min wait ran out:\n${a.out}`);
  assert.equal(a.status, 3, `the waiter did not read INCONCLUSIVE (exit ${a.status}):\n${a.out}`);
  assert.match(a.out, /^INCONCLUSIVE no grant: no build grant came within 0\.1 min/m);
  assert.ok(a.ended - since >= wait * 60_000, `the waiter gave up ${(a.ended - since) / 1000} s after it got in line, before its ${wait * 60} s wait ran out`);
  assert.equal(box.ran(), '', 'the command ran without a grant');
  await disk.stop();
});

test('a waiter\'s table write that fails with ENOSPC leaves no temp file of its own behind', { skip: noFull }, async (t) => {
  const box = sandbox(t);
  const holders = await box.hold();
  const a = await box.waiter('A');
  const temp = box.temp(a.pid);
  // One failed write: the temp file is made the full disk once, and not again.
  const disk = box.full(a.pid);
  assert.ok(await until(disk.planted, 10_000), 'the full disk could not be set up');
  await disk.stop();
  assert.ok(await until(() => !present(temp) || a.status !== null, 30_000) && !present(temp), `the failed write left its temp file ${temp.slice(box.dir.length + 1)} behind (waiter exit ${a.status}):\n${a.out}`);
  assert.equal(a.status, null, `the waiter ended on the failed write (exit ${a.status}):\n${a.out}`);
  for (const holder of holders) holder.release();
  assert.ok(await until(() => a.status !== null, 60_000), `the waiter was never granted:\n${a.out}`);
  assert.equal(a.status, 0, a.out);
  assert.equal(box.ran(), 'A\n');
  const left = readdirSync(box.table).filter((name) => name.endsWith(`.${a.pid}`));
  assert.deepEqual(left, [], `the waiter left files of its own in the table folder: ${left.join(', ')}`);
});

test('a waiter whose table write fails with another error (EISDIR) still ends BLOCKED, its command not run', { skip: noFull }, async (t) => {
  const box = sandbox(t);
  await box.hold();
  const a = await box.waiter('A');
  // Its temp table file is a directory, so the write fails with EISDIR, not ENOSPC.
  mkdirSync(box.temp(a.pid));
  assert.ok(await until(() => a.status !== null, 30_000), `the waiter kept waiting on a write that failed with EISDIR:\n${a.out}`);
  assert.equal(a.status, 2, `the waiter did not end BLOCKED (exit ${a.status}):\n${a.out}`);
  assert.match(a.out, /^BLOCKED throttle: /m);
  assert.equal(box.ran(), '', 'the command ran');
});

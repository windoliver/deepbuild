// #3587: a terminal's Ctrl-C, a SIGINT to the preflight's process group, still ends the measured checks and their
// children within 30 s; preflight exits 130 and gives back its timed grant.
import assert from 'node:assert/strict';
import test from 'node:test';
import { HUNG_CHECKS, alive, entry, exitBy, readPids, shown, sleep, start, throttleLog, timedGrant, until } from './helpers.mjs';

test('#3587.62b7650e a SIGINT to the preflight\'s process group while a never-ending check and its child run ends it within 30 s with exit 130, neither left alive, timed released', { timeout: 5 * 60_000 }, async (t) => {
  // A budget far past the test, so only the SIGINT stops the checks.
  const cwd = entry(t, { checks: HUNG_CHECKS, limit: 600_000, margin: 0.5 });
  const run = start(t, cwd, { detached: true });
  const grantAt = await timedGrant(run);
  assert.ok(grantAt, `the preflight never took its timed grant on its own table within two minutes: ${shown(run)}`);
  assert.ok(await until(() => readPids(cwd).child && run.out.includes('check started'), 60_000), `the stub check never started: ${shown(run)}`);
  const pids = readPids(cwd);
  await sleep(500);
  run.look();
  // The terminal's group is the one the preflight leads.
  process.kill(-run.pid, 'SIGINT');
  const sent = performance.now();
  const ended = await exitBy(run, sent + 30_000);
  assert.ok(ended, `the preflight was still running 30 s after a SIGINT to its process group: ${shown(run)}`);
  assert.equal(ended.code, 130, `expected exit 130 (128 + SIGINT): ${shown(run)}`);
  await until(() => !alive(pids.check) && !alive(pids.child), 1000);
  const left = ['check', 'child'].filter((name) => alive(pids[name]));
  assert.deepEqual(left, [], `left alive after the preflight ended: ${left.map((name) => `the ${name} (pid ${pids[name]})`).join(', ')}`);
  const log = throttleLog(cwd);
  const grant = log.find((line) => line.event === 'granted' && line.class === 'timed');
  assert.ok(log.some((line) => line.event === 'released' && line.id === grant.id), `timed grant ${grant.id} was not released: ${JSON.stringify(log)}`);
});

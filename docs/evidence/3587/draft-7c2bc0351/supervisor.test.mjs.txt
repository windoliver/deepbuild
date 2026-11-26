// #3587: work whose supervising preflight is gone stops before its next step. The process scripts/preflight becomes
// (it execs node on scripts/preflight.mjs) is SIGKILLed while the checks run; the checks then end and pass, and
// scripts/perf.mjs must never start.
//
// scripts/lease is replaced in this entry by one that records it ran and runs its command: the copy's own lease asks
// throttle.mjs for a build grant, and once the supervisor is gone its orphaned work is no longer under this test run,
// where alone DEEP_THROTTLE_TABLE is read, so the real lease would refuse the entry's table and keep perf from
// starting whatever the preflight did. On a machine's own table that orphan's perf run goes on.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { alive, entry, readPids, shown, sleep, start, timedGrant, until } from './helpers.mjs';

const CHECKS = `
import { existsSync, writeFileSync } from 'node:fs';
writeFileSync('pids.json', JSON.stringify({ check: process.pid }));
console.log('check started');
const by = Date.now() + 60_000;
while (!existsSync('go') && Date.now() < by) await new Promise((done) => setTimeout(done, 50));
console.log('check passed');
`;
const PERF = `import { writeFileSync } from 'node:fs'; writeFileSync('perf-ran', String(process.pid)); console.log('perf ran');`;
const LEASE = '#!/bin/sh\necho "$$" > lease-ran\nexec "$@"\n';

test('#3587.c4fdbceb when the process scripts/preflight becomes is SIGKILLed while the checks run, and the checks then end and pass, scripts/perf.mjs never starts', { timeout: 5 * 60_000 }, async (t) => {
  const cwd = entry(t, { checks: CHECKS, perf: PERF, lease: LEASE, limit: 600_000, margin: 0.5 });
  const run = start(t, cwd, { wrapper: true, detached: true });
  const grantAt = await timedGrant(run);
  assert.ok(grantAt, `the preflight never took its timed grant on its own table within two minutes: ${shown(run)}`);
  assert.ok(await until(() => readPids(cwd).check && run.out.includes('check started'), 60_000), `the stub check never started: ${shown(run)}`);
  run.look();
  const work = [...run.tracked];
  process.kill(run.pid, 'SIGKILL');
  await run.exited;
  writeFileSync(join(cwd, 'go'), '');
  // The work ends once it has nothing more to run: perf, harness and release lanes included.
  const settled = await until(() => work.every((pid) => !alive(pid)), 60_000);
  await sleep(500);
  assert.equal(existsSync(join(cwd, 'perf-ran')), false, `scripts/perf.mjs started after its supervising preflight was SIGKILLed${existsSync(join(cwd, 'lease-ran')) ? ', through scripts/lease' : ''}: the work went on with no one watching. Output:\n${run.out.slice(-4000)}`);
  assert.ok(settled, `processes the preflight started still run 60 s after it was SIGKILLed and the checks passed: ${work.filter(alive).join(', ')}`);
});

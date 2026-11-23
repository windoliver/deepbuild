// #3238 AC2: a command the script runs under an ancestor's `test` grant starts at once, and the throttle's log shows
// `passed` for it and no build request, as a lint that affected.mjs runs through the script under its run's grant
// does. Every build slot is held by a holder outside the run, and the readings leave no room for a second test grant,
// so a request of the job's own of either class waits: the twin `own-grant`, which drops the inherited grant and asks
// for one of its own, waits behind its own run and the holders, and fails here, naming the job.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC2, BUILD_SLOTS, copyScripts, dump, holdBuild, log, running, sandbox, start, startOf, table, when } from './helpers.mjs';

const JOB = 'repo-rules-lint';

test(`${AC2} a command scripts/lease runs under an ancestor's test grant starts at once, the log showing passed for it and no build request`, async (t) => {
  const box = sandbox(t);
  const lease = copyScripts(box);
  // A loaded machine, as a test's own table reads it (section 6): no test grant past the first starts.
  const readings = join(box.dir, 'readings.json');
  writeFileSync(readings, JSON.stringify({ memory: 2 ** 40, load: 1000, cores: 1 }));
  box.env.DEEP_THROTTLE_READINGS = readings;
  const holders = await holdBuild(box, BUILD_SLOTS);

  // The run: a test grant whose command is the job through the script.
  const run = start(box, [process.execPath, join(box.scripts, 'throttle.mjs'), 'test', '--wait', '1', '--', lease, 'node', box.stub, JOB], 'run');
  const shown = () => dump(box, run);
  // A request in the table that isn't the run's own (its throttle.mjs's, granted at once) is the job's.
  const seen = await when(box, () => {
    if (startOf(box, JOB)) return 'started';
    if ((table(box)?.requests ?? []).some((request) => request.pid !== run.pid)) return 'waits';
    if (!running(run)) return 'ended';
    return null;
  }, 180_000);
  assert.equal(seen, 'started', `the job \`node stub.mjs ${JOB}\` didn't start at once under its run's test grant: ${seen === 'waits' ? 'a request of its own waits in the table' : seen === 'ended' ? 'its run ended first' : 'nothing happened in 3 min'}\n${shown()}`);

  const grant = log(box).find((entry) => entry.event === 'granted' && entry.class === 'test');
  assert.ok(grant, `the log shows no test grant for the run\n${shown()}`);
  const token = `test:${grant.id}`;
  assert.equal(startOf(box, JOB).throttle, token, `the job \`${JOB}\` doesn't hold its run's test grant ${token}\n${shown()}`);
  assert.ok(log(box).some((entry) => entry.event === 'passed' && entry.through === token), `the log shows no passed entry through the run's grant ${token} for the job \`${JOB}\`\n${shown()}`);
  const own = log(box).filter((entry) => entry.class === 'build' && ['granted', 'timeout'].includes(entry.event) && !holders.includes(entry.id));
  assert.deepEqual(own, [], `the log shows a build request for the job \`${JOB}\`\n${shown()}`);
});

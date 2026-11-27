import assert from 'node:assert/strict';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC2, BUILD_SLOTS, copyScripts, dump, holdBuild, log, running, sandbox, start, startOf, table, when } from '../3238/helpers.mjs';

const JOB = 'repo-rules-lint';

test(`${AC2} a command scripts/lease runs under an ancestor's test grant starts at once, the log showing passed for it and no build request`, async (t) => {
  const box = sandbox(t);
  const lease = copyScripts(box);
  const readings = join(box.dir, 'readings.json');
  writeFileSync(readings, JSON.stringify({ memory: 2 ** 40, load: 1000, cores: BUILD_SLOTS + 2 }));
  box.env.DEEP_THROTTLE_READINGS = readings;
  const holders = await holdBuild(box, BUILD_SLOTS);
  writeFileSync(`${readings}.tmp`, JSON.stringify({ memory: 0, load: 1000, cores: BUILD_SLOTS + 2 }));
  renameSync(`${readings}.tmp`, readings);

  const run = start(box, [process.execPath, join(box.scripts, 'throttle.mjs'), 'test', '--wait', '1', '--', lease, 'node', box.stub, JOB], 'run');
  const shown = () => dump(box, run);
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

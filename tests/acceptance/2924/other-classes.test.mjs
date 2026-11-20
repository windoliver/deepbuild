// #2924 AC7: timed, build and bay-pair grant as before, whatever DEEP_THROTTLE_READINGS shows. build and bay-pair keep
// their fixed limits (section 6's table: build 2 on the Spark and 1 on the Mac, bay pair 3 and 1); a top-level timed
// request waits for the machine's own load below its cores, which a test can't set, so that case checks whichever
// side the machine's load allows when it runs.
import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import test from 'node:test';
import { GiB, dump, finish, readings, request, sandbox, started, waits } from './helpers.mjs';

const LIMIT = process.platform === 'darwin' ? { build: 1, 'bay-pair': 1 } : { build: 2, 'bay-pair': 3 };
// Readings that would stop any test grant past the first.
const CROWDED = { memory: 0, load: 1000, cores: 1 };

for (const cls of ['build', 'bay-pair']) {
  test(`#2924.AC7 ${cls} grants its fixed ${LIMIT[cls]} at once under readings of load 1000 on 1 core and 0 bytes, and the next waits for a slot (${process.platform})`, { timeout: 60_000 }, async (t) => {
    const box = sandbox(t);
    const env = { DEEP_THROTTLE_READINGS: readings(box, 'readings', CROWDED) };
    const holders = [];
    for (let k = 1; k <= LIMIT[cls]; k++) {
      holders.push(request(box, `${cls}-${k}`, { cls, env }));
      await started(box, holders.at(-1), 15_000, holders, cls);
    }
    const next = request(box, 'next', { cls, env, exit: true });
    await waits(box, next, 8_000, holders, `while ${LIMIT[cls]} ${cls} grants were held`);
    finish(box, `${cls}-1`);
    await started(box, next, 15_000, holders, cls);
    assert.equal(await next.done, 0, dump(box, ...holders, next));
  });
}

test('#2924.AC7 a top-level timed request follows the machine\'s load against its cores, not DEEP_THROTTLE_READINGS', { timeout: 60_000 }, async (t) => {
  const load = loadavg()[0], cores = cpus().length;
  const box = sandbox(t);
  if (load < 0.75 * cores) {
    // The machine is idle enough: crowded readings don't make timed wait.
    const run = request(box, 'timed', { cls: 'timed', exit: true, env: { DEEP_THROTTLE_READINGS: readings(box, 'readings', CROWDED) } });
    await started(box, run, 15_000, [], 'timed');
    assert.equal(await run.done, 0, dump(box, run));
  } else if (load > 1.25 * cores) {
    // The machine is loaded: idle readings don't let timed through.
    const run = request(box, 'timed', { cls: 'timed', exit: true, env: { DEEP_THROTTLE_READINGS: readings(box, 'readings', { memory: 1024 * GiB, load: 0, cores: 1024 }) } });
    await waits(box, run, 8_000, [], `while the machine's load is ${load} on ${cores} cores`);
  } else {
    t.skip(`INCONCLUSIVE: the machine's load ${load} is too near its ${cores} cores to say which way timed should go`);
  }
});

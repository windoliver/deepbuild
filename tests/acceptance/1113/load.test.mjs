// #1113: the throttle log shows no top-level timed grant started at a load above the cores (README: Load).
import assert from 'node:assert/strict';
import { loadavg } from 'node:os';
import test from 'node:test';
import { CORES, dump, event, grants, hold, sandbox, topLevel } from './helpers.mjs';

test('#1113.a4cc0a86 the throttle log shows no top-level timed grant started at load > cores, and a nested timed under a timed grant passes through', async (t) => {
  // A top-level timed grant waits for load below the cores, so on a machine above them none can start here.
  if (loadavg()[0] >= CORES) return t.skip(`INCONCLUSIVE: load ${loadavg()[0].toFixed(1)} is at or above the ${CORES} cores, so no top-level timed grant can start`);
  const box = sandbox(t);
  const single = await hold(box, 'timed', 1, { name: 'alone' }).done;
  const sampled = loadavg()[0];
  // A preflight or perf run holds timed, and its child asks for timed again.
  const measured = await hold(box, 'timed', 1, { name: 'measured', then: [{ class: 'timed', wait: 0.05, child: { name: 'nested' } }] }).done;
  const all = dump(box, single, measured);
  assert.equal(single.status, 0, all);
  assert.equal(event(box, 'measured', 'returned')?.status, 0, `the nested timed request did not pass through\n${all}`);
  assert.equal(event(box, 'nested', 'start')?.throttle, event(box, 'measured', 'start')?.throttle, `the nested timed command ran under another grant than its ancestor's\n${all}`);
  const timed = grants(box, 'timed').filter(topLevel);
  assert.equal(timed.length, 2, `two top-level timed grants were made (the nested one passes through)\n${all}`);
  for (const line of timed) {
    const load = Number(line.load), cores = line.cores === undefined ? CORES : Number(line.cores);
    assert.ok(Number.isFinite(load) && load >= 0, `a top-level timed grant with no load: ${line.text}`);
    assert.ok(load < cores, `a top-level timed grant started at load ${load} with ${cores} cores: ${line.text}`);
    // The logged load is the machine's: within 2, or half, of the one-minute load read just after.
    assert.ok(Math.abs(load - sampled) <= Math.max(2, sampled / 2), `logged load ${load}, machine's ${sampled.toFixed(2)}: ${line.text}`);
  }
});

// #1121 AC5: env-resources finds a free port on Linux, where lsof is /usr/bin/lsof. First env-local's port kind,
// through its public entry, on this machine; then, on the Spark only, the hub's own env-resources suite, whose stacks
// lease ports and list their listeners. Elsewhere each skips with a platform note after what it can check (never PASS).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, dump, LONG, lsofWhere, MACHINE, NOT_SPARK, probePorts, run, sandbox, SPARK } from './helpers.mjs';

const lsofRuns = (ran) => ran.filter(({ file }) => /(^|\/)lsof$/.test(file)).map(({ file, error }) => `${file}${error ? ` (${error})` : ' (ran)'}`).join(', ') || 'no lsof';

test('#1121.301969cb env-local\'s port kind finds a free port, and reads one a process listens on as taken', LONG, async (t) => {
  const box = sandbox(t);
  const probe = await probePorts(box);
  assert.ok(probe.hasFree, 'env-local\'s port kind has no free check');
  assert.equal(probe.free, true, `on ${MACHINE}, env-local read port ${probe.freePort}, which nothing listens on, as taken; it ran ${lsofRuns(probe.ran)}; ${lsofWhere()}`);
  assert.equal(probe.taken, false, `on ${MACHINE}, env-local read port ${probe.heldPort}, which this test listens on, as free; it ran ${lsofRuns(probe.ran)}`);
  assert.ok(probe.ran.some(({ file, spawned }) => /(^|\/)lsof$/.test(file) && spawned), `env-local found the port free without a working lsof: it ran ${lsofRuns(probe.ran)}; ${lsofWhere()}`);
  if (!SPARK) t.skip(NOT_SPARK);
});

test('#1121.301969cb the hub\'s env-resources suite passes on the Spark, its stacks leasing free ports and listing their listeners', { ...LONG, skip: SPARK ? false : NOT_SPARK }, async (t) => {
  const box = sandbox(t);
  const suite = 'packages/hub/test/env-resources.test.ts';
  const ran = await run(box, [process.execPath, join(CHECKOUT, 'node_modules/vitest/vitest.mjs'), 'run', suite], { cwd: CHECKOUT, env: { HOME: process.env.HOME } });
  const sbin = ran.stdout.includes('/usr/sbin/lsof') || ran.stderr.includes('/usr/sbin/lsof') ? '; the output names /usr/sbin/lsof' : '';
  assert.equal(ran.status, 0, `${suite} failed on ${MACHINE}${sbin}; ${lsofWhere()}\n${dump(ran)}`);
  assert.doesNotMatch(ran.stdout, /\b\d+ skipped\b/, `${suite} skipped tests on ${MACHINE}\n${dump(ran)}`);
});

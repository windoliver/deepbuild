// AC2 (#3333.5a039cd1): a cargo test run that did start keeps today's reading: a real compile error, from the real
// cargo on a fixture whose test doesn't compile, reads FAIL. These pass on the base; the planted reader twins.json
// names, which reads every non-zero exit with no failed target as INCONCLUSIVE, fails them (twins/README.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CARGO_TEST, laneRun, MINUTES, read, run, sandbox, workspace } from './helpers.mjs';

function readsFail({ ran, results, reading, all }) {
  assert.notEqual(ran.status, 0, `the fixture's test doesn't compile, so cargo test fails\n${all}`);
  assert.match(ran.output, /error\[E0308\]/, `cargo reports the compile error\n${all}`);
  const failed = (results.failures ?? []).filter(({ state }) => state === 'FAIL');
  assert.ok(failed.some(({ message }) => /^error/.test(message ?? '')), `cargoResults reads the compile error as a FAIL naming it\n${all}`);
  assert.ok(reading.tests.some(({ state }) => state === 'FAIL'), `the lane's reading has a FAIL row\n${all}`);
  assert.notEqual(reading.found?.state, 'INCONCLUSIVE', `a compile error is no missing grant: the lane doesn't read INCONCLUSIVE\n${all}`);
}

test('#3333.5a039cd1 a real compile error in a cargo lane the throttle granted still reads FAIL', MINUTES, async (t) => {
  readsFail(await laneRun(t, { kind: 'compile-error', full: false }));
});

test('#3333.5a039cd1 a real compile error in cargo test run without the throttle still reads FAIL', MINUTES, async (t) => {
  const box = sandbox(t);
  const root = workspace(box, 'compile-error');
  const ran = await run(CARGO_TEST, { cwd: root, env: box.env, box });
  const { results, run: reading } = await read(box, root, ran.output, ran.status ?? 1);
  readsFail({ ran, results, reading, all: `$ ${CARGO_TEST.join(' ')}  (exit ${ran.status})\n${ran.output.trim()}\n--- cargoResults\n${JSON.stringify(results, null, 1)}\n--- readRun\n${JSON.stringify(reading, null, 1)}` });
});

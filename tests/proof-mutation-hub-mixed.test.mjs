// #2835 regression: the mutation lane's group run holds a proven test that starts the copy's hub and a proven test
// that names neither the hub's nor the CLI's package. In StrykerJS's initial run the hub test finds both binaries and
// the other test finds none the lane put in the copy.
import assert from 'node:assert/strict';
import test from 'node:test';
import { base, change, dump, HUB_TEST, initialRun, NEITHER_TEST, proof, reportsMutants, sandbox } from './acceptance/2835/helpers.mjs';

test('in the mutation lane group run, a test naming neither package finds no hub binary while a hub test finds both', { timeout: 590_000 }, (t) => {
  const box = sandbox(t);
  base(box);
  change(box, { 'tests/acceptance/2835/hub.test.mjs': HUB_TEST, 'tests/acceptance/2835/neither.test.mjs': NEITHER_TEST });
  const { result, seen } = proof(t, box, ['mutation'], { bay: false });
  const initial = initialRun(seen, result);
  const hub = initial.filter((row) => 'status' in row), neither = initial.filter((row) => 'found' in row);
  assert.ok(hub.length > 0 && neither.length > 0, `StrykerJS's initial runs ran both tests\n${JSON.stringify(seen)}\n${dump(result)}`);
  for (const row of hub) assert.equal(row.status, 0, `the hub found no binary under the mutation copy's target/ (${row.stderr})\n${dump(result)}`);
  for (const row of neither) assert.deepEqual(row.found, [], `a test naming neither package found the lane's binaries in the mutation copy\n${dump(result)}`);
  reportsMutants(result);
});

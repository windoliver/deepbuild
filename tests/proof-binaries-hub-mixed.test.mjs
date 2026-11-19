// #2817 regression: one before-lane run holds a test that starts the copy's hub and one that names neither the hub's
// nor the CLI's package. On each side the hub test finds both binaries and the other test finds none the lane put.
import assert from 'node:assert/strict';
import test from 'node:test';
import { before, dump, fixture, HUB_TEST, NEITHER_TEST, sandbox } from './acceptance/2817/helpers.mjs';

test('in one before-lane run, a test naming neither package finds no hub binary while a hub test finds both', { timeout: 290_000 }, (t) => {
  const box = sandbox(t);
  fixture(box, { 'tests/acceptance/2817/hub.test.mjs': HUB_TEST, 'tests/acceptance/2817/neither.test.mjs': NEITHER_TEST });
  const { result, seen } = before(t, box);
  const hub = seen.filter((row) => 'status' in row), neither = seen.filter((row) => 'found' in row);
  assert.deepEqual(hub.map(({ side }) => side).sort(), ['base', 'change'], `the hub test runs once on each side\n${dump(result)}`);
  assert.deepEqual(neither.map(({ side }) => side).sort(), ['base', 'change'], `the other test runs once on each side\n${dump(result)}`);
  for (const row of hub) assert.equal(row.status, 0, `${row.side} side: the hub found no binary under its copy's target/ (${row.stderr})\n${dump(result)}`);
  for (const row of neither) assert.deepEqual(row.found, [], `${row.side} side: a test naming neither package found the lane's binaries\n${dump(result)}`);
});

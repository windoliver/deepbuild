// Blind redraft (#2833) of #1113's first drain test: the test class is filled to the limit throttle.mjs states for this
// platform (./helpers.mjs testLimit), not a hard-coded 4. Name, criterion, assertions and expected values are the original's.
import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMIT, dump, event, events, hold, sandbox, started } from '../1113/helpers.mjs';
import { testLimit } from './helpers.mjs';

const TEST_LIMIT = testLimit();

test('#1113.ca815dac nested build and test requests under a build holder pass through, though both classes are full outside its chain', async (t) => {
  const box = sandbox(t);
  // A holds a build grant; after a second, its descendants ask for build and for test, each waiting at most 3 s.
  const a = hold(box, 'build', 1, { name: 'A', then: [
    { delay: 1_000, class: 'build', wait: 0.05, child: { name: 'A-build' } },
    { class: 'test', wait: 0.05, child: { name: 'A-test' } },
  ] });
  await started(box, 'A');
  // Meanwhile other chains fill the rest of build and all of test for 6 s.
  const others = [...Array.from({ length: LIMIT.build - 1 }, (_, i) => ['build', `build-${i}`]), ...Array.from({ length: TEST_LIMIT }, (_, i) => ['test', `test-${i}`])];
  for (const [kind, name] of others) hold(box, kind, 1, { name, hold: 6_000 });
  for (const [, name] of others) await started(box, name);
  const result = await a.done;
  const firstEnd = Math.min(...others.map(([, name]) => event(box, name, 'end')?.t ?? Infinity));
  for (const name of ['A-build', 'A-test']) {
    const start = event(box, name, 'start');
    assert.ok(start, `${name} never ran: a nested request under a build holder must pass through\n${dump(box, result)}`);
    assert.ok(start.t < firstEnd, `${name} waited for a grant outside its chain to end\n${dump(box, result)}`);
  }
  assert.deepEqual(events(box).filter((e) => e.name === 'A' && e.event === 'returned').map((e) => e.status), [0, 0], dump(box, result));
});

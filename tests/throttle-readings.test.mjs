// The test class's grants past the first are decided by the machine's readings, under the LIMITS ceiling (#2924,
// docs/parallel-proof.md section 6). The rule's edges, which tests/acceptance/2924 drives through the CLI, except the
// ones no test can wait for there: a grant 5 minutes old no longer settles, and one of no known time does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const throttle = fileURLToPath(new URL('../scripts/throttle.mjs', import.meta.url));
const GiB = 2 ** 30, MIN = 60_000, NOW = 1_000_000_000_000;
const ceiling = process.platform === 'darwin' ? 2 : 6;
// A run's memory: 24 GiB on the Spark, 8 GiB on the Mac (#2980).
const RUN = (process.platform === 'darwin' ? 8 : 24) * GiB;
const idle = { memory: 1000 * GiB, load: 0, cores: 20 };
const old = (n) => Array.from({ length: n }, () => ({ at: NOW - 10 * MIN }));

test('the rule: the first test grant always starts; past it, the readings and the ceiling decide', async () => {
  const { roomForTest } = await import(throttle);
  assert.equal(roomForTest([], { memory: 0, load: 500, cores: 1 }, NOW), true, 'the first grant waited on the readings');
  assert.equal(roomForTest(old(1), { ...idle, load: 20 }, NOW), false, 'a second grant started at a load of the cores');
  assert.equal(roomForTest(old(1), { ...idle, load: 19.9 }, NOW), true);
  assert.equal(roomForTest(old(1), { ...idle, memory: RUN - 1 }, NOW), false, 'a second grant started with less than a run\'s memory');
  assert.equal(roomForTest(old(1), { ...idle, memory: RUN }, NOW), true);
  // A grant under 5 minutes old, or of no known time, reserves a run's memory the readings don't show yet.
  for (const settling of [{ at: NOW - 5 * MIN + 1 }, {}]) {
    assert.equal(roomForTest([settling], { ...idle, memory: 2 * RUN - 1 }, NOW), false, `a settling grant ${JSON.stringify(settling)} reserved nothing`);
    assert.equal(roomForTest([settling], { ...idle, memory: 2 * RUN }, NOW), true);
  }
  assert.equal(roomForTest([{ at: NOW - 5 * MIN }], { ...idle, memory: RUN }, NOW), true, 'a 5-minute-old grant still reserved memory');
  assert.equal(roomForTest(old(ceiling - 1), idle, NOW), true);
  assert.equal(roomForTest(old(ceiling), idle, NOW), false, 'a grant past the ceiling started');
  // A test's own table given no readings decides by the ceiling alone.
  assert.equal(roomForTest(old(ceiling - 1), null, NOW), true);
  assert.equal(roomForTest(old(ceiling), null, NOW), false);
});

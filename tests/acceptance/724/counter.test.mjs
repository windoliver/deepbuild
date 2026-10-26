// #724 acceptance: reading the counter. `parseInstructions(report, platform)` on recorded
// /usr/bin/time reports, one with the counter and two without, and `measureOnce` on this Mac's real
// counter. The reports are the boundary the lane doesn't own; nothing else is planted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { api, BASE_ITERATIONS, fixture, independentCounts, program, scratch } from './helpers.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('instructions retired are read from /usr/bin/time -l\'s report', async () => {
  const { parseInstructions } = await api('parseInstructions');
  // The recorded report also holds "cycles elapsed" and "peak memory footprint" lines; only one is the count.
  assert.equal(parseInstructions(fixture('time-l-darwin.txt'), 'darwin'), 688_381_201);
});

test('a host whose time reports no counter reads it missing, null and never 0', async () => {
  const { parseInstructions } = await api('parseInstructions');
  // The same macOS report with its "instructions retired" and "cycles elapsed" lines gone, and GNU
  // time's report in the format the lane asks for on Linux, which has no counter at all.
  for (const [name, platform] of [['time-l-no-counter.txt', 'darwin'], ['time-f-linux.txt', 'linux']]) {
    let count;
    assert.doesNotThrow(() => { count = parseInstructions(fixture(name), platform); }, `${name}: a missing counter is recorded, not an error`);
    assert.equal(count, null, `${name} on ${platform}: ${JSON.stringify(count)}`);
  }
});

test('every measured run records its instructions retired from the real counter, beside CPU time and peak memory', async (t) => {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: the counter is read from macOS\'s /usr/bin/time -l');
  const { measureOnce } = await api('measureOnce');
  const cwd = scratch(t);
  writeFileSync(join(cwd, 'bench.awk'), program(BASE_ITERATIONS));
  const expected = independentCounts(t, [BASE_ITERATIONS])[BASE_ITERATIONS];
  const run = measureOnce(['/usr/bin/awk', '-f', 'bench.awk'], cwd);
  assert.equal(run.status, 0);
  assert.ok(Number.isSafeInteger(run.cpuMs) && run.peakBytes > 0, JSON.stringify(run));
  assert.ok(Number.isSafeInteger(run.instructions) && run.instructions > 0, `instructions: ${JSON.stringify(run.instructions)}`);
  // Within 2% of this test's own reading of the same counter: the count, not cycles or a footprint.
  assert.ok(Math.abs(run.instructions / expected - 1) < 0.02, `measureOnce read ${run.instructions}, the counter ${expected}`);
});

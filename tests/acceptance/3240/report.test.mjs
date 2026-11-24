// #3240.7baf5908: `load --report` over a fixture log prints the share of minutes with a request waiting beside two or
// more idle cores, and GPU seconds by class and `outside`. The fixture is copied to `load.log` in the test's own table
// folder; the lines asserted are the ones section 6 states (README: The surface, and the fixture).
import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { load, running, sandbox, until } from './helpers.mjs';

test('#3240.7baf5908 load --report over a fixture log prints GPU seconds by class and outside, over the samples whose GPU was read, above the cores or not, and the share of minutes with a request waiting beside two or more idle cores', { timeout: 60_000 }, async (t) => {
  const box = sandbox(t);
  copyFileSync(new URL('fixtures/line-and-gpu.jsonl', import.meta.url), join(box.table, 'load.log'));
  const run = load(box, ['--report']);
  await until(() => !running(run), 30_000);
  assert.ok(!running(run), `load --report was still running after 30 s\n${run.output()}`);
  await run.done;
  const out = run.output();
  const lines = out.split('\n').map((line) => line.trimEnd());

  // The line: of the five samples that hold waiting (the failed one doesn't), three had a request waiting beside 2
  // idle cores or more (idle 5, exactly 2 and 3); one had nothing waiting beside 8, one 18 waiting beside 1.5.
  assert.match(out, /^60(\.0+)?% of minutes with a request waiting beside two or more idle cores \(3 of 5\)$/m, `the share of minutes with a request waiting beside two or more idle cores\n${out}`);

  // GPU, over every sample, above the cores or not: read in samples 1 to 4 (5 failed, 6 holds gpuUnread),
  // 5 + 15.75 + 7.5 + 5 seconds.
  assert.match(out, /^GPU read in 4 of 6 samples, 33\.250 s in all$/m, `GPU read in <n> of <m> samples, <s> s in all\n${out}`);
  // By class over those read: test 2 + 4.5 + 3.5, build 1.25, outside 3 + 10 + 4 + 5. The timed grant is held only in
  // the sample whose GPU wasn't read, so it has no line. Over the minutes above the cores alone it would be test 6.5,
  // build 1.25 and outside 18.
  const gpu = lines.map((line) => line.match(/^GPU (?!read in )(\S+) (\d+\.\d{3}) s, (\d+\.\d)%$/)).filter(Boolean).map(([, name, seconds, share]) => ({ name, seconds, share: Number(share) }));
  assert.deepEqual(gpu.map(({ name, seconds }) => `${name} ${seconds}`).sort(), ['build 1.250', 'outside 22.000', 'test 10.000'], `one GPU line a class that held a grant in the samples read and one for outside, each with its seconds\n${out}`);
  // Shares of 33.25 s, to one decimal, adding up to 100.0: 30.075%, 3.759% and 66.165%, which rounded each alone
  // sum to 100.1.
  const exact = { test: 30.075, build: 3.759, outside: 66.165 };
  for (const { name, share } of gpu) assert.ok(Math.abs(share - exact[name]) < 0.1, `GPU ${name}'s share is ${share}%, not ${exact[name]}% to one decimal\n${out}`);
  assert.equal(gpu.reduce((sum, { share }) => sum + Math.round(10 * share), 0), 1000, `the GPU shares add up to 100.0\n${out}`);
  // The five commands gpuTop named under no grant with the most seconds in all; gpudraw and exporter were under
  // grants, and compositor is the sixth.
  const [, named] = out.match(/^GPU top commands under no grant: (.*)$/m) ?? [];
  assert.ok(named, `the line of the top commands under no grant\n${out}`);
  assert.deepEqual(named.split(', ').sort(), ['WindowServer 12.500 s', 'encoder 2.500 s', 'indexer 0.500 s', 'renderer 5.500 s', 'viewer 0.750 s'].sort(), `the five commands under no grant with the most GPU seconds\n${out}`);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dump, load, running, samples, sandbox, until } from './helpers.mjs';

const ANOTHER = /^INCONCLUSIVE load: another sampler, pid (\d+), writes this log$/;
const linesSaying = (run) => run.output().split('\n').map((line) => line.trim()).filter((line) => line.startsWith('INCONCLUSIVE load:'));

test('#3697.b7f96141 a second load on a table whose sampler runs writes no sample, says which pid writes the log and exits 3, and one started after the first is stopped by its PID samples', { timeout: 180_000 }, async (t) => {
  const box = sandbox(t);
  const first = load(box, 'the first load');
  // deadline: a sample takes a second and its listings; 60 s bound a sampler that writes none
  await until(() => samples(box).length > 0 || !running(first), 60_000);
  assert.equal(samples(box).length, 1, `the first load wrote ${samples(box).length} samples at its start, not 1\n${dump(box, first)}`);
  assert.ok(running(first), `the first load ended after its first sample\n${dump(box, first)}`);

  const second = load(box, 'the second load');
  // deadline: the criterion's 10 s for the second load to exit
  await until(() => !running(second), 10_000);
  const ended = !running(second);
  if (ended) await second.done;
  assert.ok(running(first), `precondition: the first load ended while the second ran\n${dump(box, first, second)}`);
  assert.equal(samples(box).length, 1, `the log gains no line from the second load, yet it holds ${samples(box).length} lines with the first load's single sample\n${dump(box, first, second)}`);
  assert.ok(ended, `the second load was still running 10 s after its start\n${dump(box, first, second)}`);
  assert.equal(second.exitCode, 3, `the second load exited ${second.exitCode ?? second.signalCode}, not 3\n${dump(box, first, second)}`);
  const said = linesSaying(second);
  assert.equal(said.length, 1, `the second load printed ${said.length} INCONCLUSIVE load lines, not one\n${dump(box, first, second)}`);
  const [, pid] = said[0].match(ANOTHER) ?? [];
  assert.ok(pid, `the second load's line isn't "INCONCLUSIVE load: another sampler, pid <n>, writes this log": ${said[0]}`);
  assert.equal(Number(pid), first.pid, `the second load names pid ${pid}; the running sampler is pid ${first.pid}`);

  first.kill('SIGTERM');
  await first.done;
  const third = load(box, 'the third load');
  // deadline: a sample takes a second and its listings; 60 s bound a sampler that writes none
  await until(() => samples(box).length > 1 || !running(third), 60_000);
  assert.equal(samples(box).length, 2, `the third load, started once the first was stopped by its PID, wrote no sample\n${dump(box, first, second, third)}`);
  assert.ok(running(third), `the third load ended after its sample\n${dump(box, third)}`);
  assert.deepEqual(linesSaying(third), [], `the third load says another sampler writes the log\n${dump(box, third)}`);
  assert.ok(!('failed' in samples(box)[1]), `the third load's sample failed: ${samples(box)[1].failed}`);
  third.kill('SIGTERM');
  await third.done;
});

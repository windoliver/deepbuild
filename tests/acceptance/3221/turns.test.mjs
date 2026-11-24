// #3221 AC1: on a test's own table with a pool of 4 tokens, one run has 40 stub jobs of 10 s and a second, with 4,
// asks 30 s later. The second ends within 60 s of asking, and no sample holds more than 4 jobs running. A planted pool
// that serves jobs in the order their runs arrived fails, naming the second run (twins.json: arrival-order).
import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, dump, ended, events, mostAtOnce, pause, readings, run, sandbox, since, starts } from './helpers.mjs';

const POOL = 4;
// The criterion's numbers: 40 jobs of 10 s, a second run of 4 that asks 30 s later and ends within 60 s of asking.
const FIRST_JOBS = 40, SECOND_JOBS = 4, SECONDS = 10, LATER_MS = 30_000, WITHIN_MS = 60_000;
// The first run keeps 8 jobs started at once, twice the pool, as a run with more shards than tokens does: so it has
// jobs waiting for every token that frees, and only the order of turns lets the second run in.
const FIRST_AT_ONCE = 8;

test('#3221.2a179649 on a pool of 4 tokens, a run of 4 jobs that asks 30 s after a run of 40 ends within 60 s of asking, and no more than 4 jobs ever run at once', { timeout: 15 * 60_000 }, async (t) => {
  const box = sandbox(t);
  // The pool is a core less one of the table's readings (section 6). The load reads above the cores, as on the Mac the
  // issue names, and the memory has room for every run: an admission isn't decided by the load.
  readings(box, { memory: 1024 * GiB, load: 50, cores: POOL + 1 });
  const sleeper = { mode: ['sleep', String(SECONDS)] };
  const first = run(box, 'first', { jobs: Array(FIRST_JOBS).fill(sleeper), concurrency: FIRST_AT_ONCE });
  // deadline: the criterion's schedule, the second run asks 30 s after the first.
  await pause(LATER_MS);
  const second = run(box, 'second', { jobs: Array(SECOND_JOBS).fill(sleeper) });
  const all = () => dump(box, first, second);
  // Both runs end by themselves: 44 jobs of 10 s on 4 tokens take under 2 minutes, plus the machine's spawn time.
  assert.equal(await ended(second, 12 * 60_000, all), 0, `the second run failed\n${all()}`);
  assert.equal(await ended(first, 12 * 60_000, all), 0, `the first run failed\n${all()}`);

  const notes = events(box);
  const zero = first.asked;
  const firstStart = (name) => starts(box, name).reduce((least, e) => Math.min(least, e.at), Infinity);
  const timeline = [
    `the first run asked at +0 s and ended at ${since(zero, first.ended)}; its ${starts(box, 'first').length} jobs started from ${since(zero, firstStart('first'))}`,
    `the second run asked at ${since(zero, second.asked)}, its first job started at ${since(zero, firstStart('second'))}, and it ended at ${since(zero, second.ended)}, ${((second.ended - second.asked) / 1000).toFixed(1)} s after asking`,
    `the second run's first job started ${firstStart('second') >= first.ended ? 'after' : 'before'} the first run ended`,
  ].join('\n');
  t.diagnostic(timeline);
  assert.equal(starts(box, 'first').length, FIRST_JOBS, `the first run started ${starts(box, 'first').length} of its ${FIRST_JOBS} jobs\n${timeline}\n${all()}`);
  assert.equal(starts(box, 'second').length, SECOND_JOBS, `the second run started ${starts(box, 'second').length} of its ${SECOND_JOBS} jobs\n${timeline}\n${all()}`);

  const most = mostAtOnce(notes);
  assert.ok(most.count <= POOL, `${most.count} jobs ran at once at ${since(zero, most.at)}, more than the pool's ${POOL} tokens\n${timeline}\n${all()}`);
  // deadline: the criterion's 60 s from the second run's asking to its end.
  assert.ok(second.ended - second.asked <= WITHIN_MS, `the second run (4 jobs) ended ${((second.ended - second.asked) / 1000).toFixed(1)} s after asking, not within ${WITHIN_MS / 1000} s: its jobs waited behind the first run's\n${timeline}\n${all()}`);
});

// #2665: one real scene for a ceiling on a count. A fixture task whose command retires 5% more instructions than its
// instructions ceiling, and which also carries a time limit, measured by a real window (`throttle.mjs window`) on a
// stand-in Mac that isn't a reference Mac, the window reading a load above the cores. The scene runs on the test's turn.
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import test, { after } from 'node:test';
import { ELSEWHERE, LOADED, loads, loop, manifest, marked, recordOf, row, sandbox, SLOW, task, timed, windowOver } from './helpers.mjs';

const box = sandbox({ after }, { machine: ELSEWHERE, load: LOADED });
const LOOP = loop(20_000);

async function play() {
  // The instructions the command retires, by the test's own reading: the ceiling is their median less 5%.
  const counts = timed(box, LOOP).map(({ instructions }) => instructions).sort((a, b) => a - b);
  const ceiling = Math.round(counts[2] / 1.05);
  const repo = await marked(box, { 'benchmarks/budgets.json': manifest([task('counted', LOOP, { instructions: ceiling, p50Ms: 60_000 })]) });
  const commit = repo.commit({ 'notes.txt': 'Notes no task reads, changed.\n' }, 'Change the notes');
  const run = await windowOver(box, repo);
  return { counts, ceiling, commit, run };
}
let played;
const scene = () => (played ??= play());

test('#2665.f5e661f9 a task with a ceiling on instructions retired reads FAIL on a fixture command that retires 5% more than the ceiling, at a load above the core count and off the reference Macs, where the same command\'s time limit reads INCONCLUSIVE', SLOW, async () => {
  const s = await scene();
  const seen = loads(box);
  assert.ok(seen.window > cpus().length && seen.grant < cpus().length, `the stand-in load isn't the scene's: the window reads ${seen.window}, the grant ${seen.grant}, on ${cpus().length} cores`);
  const record = recordOf(box, s.run, s.commit, 'the commit');
  const counted = row(record, 'counted');
  assert.ok(counted?.limits?.instructions, `the record of ${s.commit} has no verdict on counted's instructions ceiling: ${JSON.stringify(record.tests)}`);
  const ceiling = counted.limits.instructions;
  assert.equal(ceiling.limit, s.ceiling, `counted's instructions ceiling was judged against ${ceiling.limit}, not ${s.ceiling}: ${JSON.stringify(ceiling)}`);
  assert.equal(ceiling.status, 'FAIL', `counted's instructions ceiling read ${ceiling.status} on a command retiring 5% more than its ${s.ceiling} (${s.counts.join(', ')} by /usr/bin/time -l), at load ${seen.window} on a ${ELSEWHERE.model}: ${JSON.stringify(ceiling)}`);
  assert.ok(Array.isArray(ceiling.runs) && ceiling.runs.length >= 5 && ceiling.runs.every((count) => Number.isSafeInteger(count) && count > s.ceiling && count < 1.2 * s.ceiling),
    `counted's readings aren't its command's instructions retired, about 5% over ${s.ceiling}: ${JSON.stringify(ceiling.runs)}`);
  assert.equal(counted.limits.p50Ms?.status, 'INCONCLUSIVE', `the same command's p50Ms limit read ${counted.limits.p50Ms?.status} on a ${ELSEWHERE.model} at load ${seen.window}: ${JSON.stringify(counted.limits.p50Ms ?? null)}`);
  assert.equal(counted.state, 'FAIL', `counted didn't read FAIL with its instructions ceiling missed: ${JSON.stringify(counted)}`);
});

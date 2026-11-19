// Blind redraft of #2574's AC2b and AC2d under #2833 (REDRAFT.md). Written from issue #2574 (AC2, as
// tests/acceptance/2574/README.md quotes it), issue #2833 and its comments, the design's Dogfooding section and
// docs/parallel-proof.md, at base c26bdb5be. Test names, criterion IDs, assertions and expected values are the
// originals' in tests/acceptance/2574/grant.test.mjs; only `fill` differs: it holds as many test slots as this
// checkout's scripts/throttle.mjs states for the platform on its LIMITS line (./helpers.mjs), not a hard-coded 2 or 4.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dump, jobLogs, LONG, NODE, probes, sandbox, SRC, start, stop, summary, throttleLog, tree, until, VITEST } from '../2574/helpers.mjs';
import { fill } from './helpers.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function within(child, ms) {
  let timer;
  const result = await Promise.race([child.done, new Promise((done) => { timer = setTimeout(() => done(null), ms); })]);
  clearTimeout(timer);
  assert.ok(result, `affected.mjs did not end within ${ms / 1000} s\nstdout so far:\n${child.out().slice(-2_500)}`);
  return result;
}
const topTest = (log, others = new Set()) => log.filter((e) => e.event === 'granted' && e.class === 'test' && e.grant === 'top-level' && !others.has(e.pid));
const show = (log) => log.map((e) => JSON.stringify(e)).join('\n');

test('#2574.AC2b while every test slot is held by other live processes the run starts no job, and starts once a slot frees', { timeout: 420_000 }, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box);
  const holders = await fill(box, 280_000);
  const others = new Set(holders.map(({ pid }) => pid));
  const child = start(box, fixture, [SRC, VITEST, NODE]);
  // The run has its selection made before it would start a job; then it is given ten more seconds to start one.
  await until(() => /^parallel (?:vitest|node):/m.test(child.out()) || child.exitCode !== null, 90_000);
  await sleep(10_000);
  const early = probes(fixture), earlyLogs = jobLogs(fixture);
  const waiting = child.exitCode === null;
  const freed = Date.now();
  stop(holders[0]);
  const run = await within(child, 240_000);
  const all = `${dump(run)}\nthrottle log:\n${show(throttleLog(box))}\nprobes:\n${JSON.stringify(probes(fixture))}`;
  assert.deepEqual(early, [], `jobs started while all ${holders.length} test slots were held by others\n${all}`);
  assert.deepEqual(earlyLogs, [], `the run opened job logs while all test slots were held by others\n${all}`);
  assert.ok(waiting, `the run ended while all test slots were held, before a slot freed\n${all}`);
  const ran = probes(fixture);
  for (const job of ['build', VITEST, NODE]) assert.ok(ran.some((p) => p.job === job), `the ${job} job never started once a slot freed\n${all}`);
  assert.deepEqual(ran.filter(({ at }) => at < freed), [], `jobs started before the slot freed\n${all}`);
  const grants = topTest(throttleLog(box), others);
  assert.ok(grants.length >= 1 && grants.every((g) => Date.parse(g.at) >= freed - 1_000), `the run's test grant did not come once the slot freed\n${all}`);
});

test('#2574.AC2d with no grant within the wait the run prints INCONCLUSIVE no grant, names each file, reads INCONCLUSIVE, exits 2 and starts no job', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box);
  await fill(box, 280_000);
  const run = await within(start(box, fixture, [SRC, VITEST, NODE], { DEEP_TEST_GRANT_WAIT: '0.02', T2574_SHRINK: '1' }), 240_000);
  const all = `${dump(run)}\nprobes:\n${JSON.stringify(probes(fixture))}`;
  const lines = run.stdout.split('\n');
  assert.ok(lines.some((line) => line.startsWith('INCONCLUSIVE no grant: no test grant came within 0.02 min')), `no "INCONCLUSIVE no grant: no test grant came within 0.02 min" line\n${all}`);
  for (const file of [VITEST, NODE]) assert.ok(lines.some((line) => line.startsWith('INCONCLUSIVE') && line.includes(file)), `no INCONCLUSIVE line names ${file}\n${all}`);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `the summary of a run with no grant reads otherwise\n${all}`);
  assert.equal(run.status, 2, `the run with no grant exited ${run.status}\n${all}`);
  assert.deepEqual(probes(fixture), [], `the run with no grant started jobs\n${all}`);
  assert.deepEqual(jobLogs(fixture), [], `the run with no grant opened job logs\n${all}`);
});

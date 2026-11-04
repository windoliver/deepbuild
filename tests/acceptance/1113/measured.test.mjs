// #1113: preflight.mjs and perf.mjs claim timed before their timers start (README: Preflight and perf).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, event, hold, launch, measuredRepo, preflightSeconds, sandbox, started } from './helpers.mjs';

const SLACK = 100;
// What preflight hands perf: a passing check workload's reading.
const OBSERVED = JSON.stringify({ status: 0, elapsedMs: 1_000, cpuMs: 400, peakBytes: 50_000_000 });

test('#1113.74ef5038 a preflight that requests timed while another session holds a bay pair waits until the pair is released, then completes, and its perf child is not BLOCKED', async (t) => {
  const box = sandbox(t);
  const { repo, env } = measuredRepo(box);
  const bay = hold(box, 'bay-pair', 1, { name: 'bay', hold: 3_000 });
  await started(box, 'bay');
  const preflight = await launch(box, [process.execPath, 'scripts/preflight.mjs'], { cwd: repo, env }).done;
  const all = dump(box, preflight, await bay.done);
  const checks = event(box, 'checks', 'start');
  assert.ok(checks, `the preflight never ran its checks\n${all}`);
  assert.ok(checks.t >= event(box, 'bay', 'end').t - SLACK, `the preflight's checks started ${event(box, 'bay', 'end').t - checks.t} ms before the bay pair was released\n${all}`);
  assert.doesNotMatch(preflight.stdout, /INCONCLUSIVE no grant/, all);
  assert.match(preflight.stdout, /^RUN perf$/m, `perf never ran\n${all}`);
  assert.doesNotMatch(preflight.stdout, /^BLOCKED perf\b/m, `preflight's perf child is BLOCKED\n${all}`);
  assert.match(preflight.stdout, /^PASS perf\b/m, all);
  assert.equal(preflight.status, 0, all);
});

test('#1113.74ef5038 a perf run started by hand that requests timed while another session holds a bay pair waits until the pair is released, then completes', async (t) => {
  const box = sandbox(t);
  const { repo, env } = measuredRepo(box);
  const bay = hold(box, 'bay-pair', 1, { name: 'bay', hold: 3_000 });
  await started(box, 'bay');
  const perf = await launch(box, [process.execPath, 'scripts/perf.mjs', OBSERVED], { cwd: repo, env }).done;
  const all = dump(box, perf, await bay.done);
  assert.ok(perf.ended >= event(box, 'bay', 'end').t - SLACK, `perf ended ${event(box, 'bay', 'end').t - perf.ended} ms before the bay pair was released\n${all}`);
  assert.doesNotMatch(perf.stdout, /INCONCLUSIVE no grant/, all);
  assert.match(perf.stdout, /^PASS perf\b/m, all);
  assert.equal(perf.status, 0, all);
});

test('#1113.dadec762 a preflight run\'s measured time contains no throttle wait: the grant precedes the timer', async (t) => {
  const box = sandbox(t);
  const { repo, env } = measuredRepo(box);
  const neighbour = hold(box, 'build', 1, { name: 'neighbour', hold: 3_000 });
  await started(box, 'neighbour');
  const preflight = await launch(box, [process.execPath, 'scripts/preflight.mjs'], { cwd: repo, env }).done;
  const all = dump(box, preflight, await neighbour.done);
  const released = event(box, 'neighbour', 'end').t;
  assert.ok(preflight.ended >= released - SLACK, `the preflight ended before the build holder outside its chain did: it never waited for timed\n${all}`);
  const seconds = preflightSeconds(preflight.stdout);
  assert.ok(seconds, `no "Checks elapsed: … preflight elapsed: …" line\n${all}`);
  // Everything the timer counts happened after the grant, which came no earlier than the release.
  const afterGrant = (preflight.ended - released) / 1000 + 0.3;
  assert.ok(seconds.preflight <= afterGrant, `preflight elapsed ${seconds.preflight} s, but only ${afterGrant.toFixed(2)} s passed after the grant could come: the wait is in the measured time\n${all}`);
  assert.ok(seconds.checks <= afterGrant, `checks elapsed ${seconds.checks} s holds the wait\n${all}`);
});

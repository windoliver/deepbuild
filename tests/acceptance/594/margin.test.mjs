// #594 acceptance, criteria 2 and 3: a change that only adds dependencies already built passes perf
// within the lane's margin, and a change that really slows the checks still fails it. Run through
// scripts/preflight.mjs in the fixture repository.
import assert from 'node:assert/strict';
import test from 'node:test';
import { describe, failedCpuMs, fixture, tail, verdict } from './helpers.mjs';

const report = (run) => `${tail(run.output)}\n--- compiles by side ---\n${run.segments.map((s) => `${s.side}\n  warm: ${describe(s.warm)}\n  measured: ${describe(s.measured)}`).join('\n')}`;

test('criteria 2 and 3: a change that only adds a dependency passes perf within the margin; the same change slowed by 3 s of CPU fails perf on cpuMs', (t) => {
  const repo = fixture(t);
  // Only a dependency: dep-b, built by preflight's own warm-up before the checks are measured.
  repo.change({ addDependency: true });
  const quick = repo.preflight();
  // Catches today's lane: the working tree's measured clippy check-compiles dep-b cold (about 2 s
  // against the base's few hundred ms), and perf fails it on cpuMs.
  assert.equal(quick.status, 0, `perf failed a change that only adds a dependency:\n${report(quick)}`);
  assert.match(quick.output, /^PASS perf \(/m, report(quick));
  assert.doesNotMatch(quick.output, /^(?:FAIL|BLOCKED) perf/m, report(quick));
  const line = verdict(quick.output);
  assert.ok(line?.base && line?.current, `no preflight verdict with both sides:\n${report(quick)}`);
  assert.equal(line.status, 'PASS', JSON.stringify(line));
  assert.ok(line.current.cpuMs <= line.base.cpuMs * 1.5, `the measured cpuMs ${line.current.cpuMs} is not within the 50% margin of the merge base's ${line.base.cpuMs}`);

  // The same tree, now with check work that spends 3 s more CPU, and a test file of its own, so the
  // run compared with the base is the copy without that test.
  repo.change({ addDependency: true, addTest: true, spinMs: 3000 });
  const slow = repo.preflight();
  // Catches a lane that exempts dependency changes, compares a run with itself or widens the margin.
  assert.equal(slow.status, 1, `perf passed checks slowed by 3 s of CPU:\n${report(slow)}`);
  assert.doesNotMatch(slow.output, /^PASS perf\b/m, report(slow));
  assert.doesNotMatch(slow.output, /^BLOCKED perf/m, report(slow));
  const failed = failedCpuMs(slow.output);
  assert.notEqual(failed, null, `perf did not fail on cpuMs:\n${report(slow)}`);
  assert.ok(failed >= 3000, `perf failed on cpuMs ${failed}, less than the 3 s the slowed checks spend:\n${report(slow)}`);
});

// #594 acceptance: the merge-base copy and the copy without the change's own tests each reuse a build
// directory of their own that perf keeps between runs, so a second preflight rebuilds no dependency on
// either side; neither side shares one with the other or with the working tree's target/. Run through
// scripts/preflight.mjs in the fixture repository, twice.
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildDir, describe, fixture, inside, isDependency, side, tail, verdict } from './helpers.mjs';

const sides = ['working tree', 'merge base', 'without own tests'];

test('a second preflight builds no dependency in either copy: each side reuses a build directory of its own, kept between runs, outside the working tree\'s target/', (t) => {
  const repo = fixture(t);
  // The #337 shape: the change adds a dependency (dep-b, about 2 s of CPU to check and as much to
  // build) and a test file of its own, so perf runs both copies.
  repo.change({ addDependency: true, addTest: true });
  const target = join(repo.repo, 'target');

  const first = repo.preflight();
  const report = (run) => `${tail(run.output)}\n--- compiles by side ---\n${run.segments.map((s) => `${s.side}\n  warm: ${describe(s.warm)}\n  measured: ${describe(s.measured)}`).join('\n')}`;
  // Catches today's lane: the copy's measured clippy compiles dep-a and dep-b cold, and perf reports
  // FAIL perf: preflight: cpuMs ... regressed beyond base, as #594 found.
  assert.equal(first.status, 0, `the first preflight failed:\n${report(first)}`);
  assert.match(first.output, /^PASS perf \(/m, report(first));
  assert.doesNotMatch(first.output, /^(?:FAIL|BLOCKED) perf/m, report(first));
  for (const name of sides) {
    const { measured } = side(first.segments, name);
    assert.deepEqual(measured.filter(isDependency), [], `the ${name} run's measured checks compiled dependencies, so it was not compared warm: ${describe(measured)}\n${report(first)}`);
  }
  const line = verdict(first.output);
  assert.ok(line?.base && line?.current, `no preflight verdict with both sides:\n${report(first)}`);
  assert.ok(line.current.cpuMs <= line.base.cpuMs * 1.5, `the measured cpuMs ${line.current.cpuMs} is not within the 50% margin of the merge base's ${line.base.cpuMs}`);

  // Each copy built its own dependencies on the first run, in a directory of its own.
  const base = side(first.segments, 'merge base');
  const without = side(first.segments, 'without own tests');
  const built = (segment) => [...segment.warm, ...segment.measured].filter(isDependency);
  assert.ok(built(base).some(({ crate }) => crate === 'dep_a'), `the merge-base copy did not build its own dependencies on the first run: ${describe(built(base))}\n${report(first)}`);
  // Catches one build directory shared by both sides: the second copy finds the first's dep-a fresh.
  for (const crate of ['dep_a', 'dep_b']) {
    assert.ok(built(without).some((compile) => compile.crate === crate), `the copy without the change's own tests did not build ${crate} itself on the first run, so it used another side's build: ${describe(built(without))}\n${report(first)}`);
  }
  const baseDirs = new Set(built(base).map(({ outDir }) => buildDir(outDir)));
  const withoutDirs = new Set(built(without).map(({ outDir }) => buildDir(outDir)));
  for (const dir of baseDirs) assert.ok(!withoutDirs.has(dir), `both sides built into ${dir}`);
  const realTarget = existsSync(target) ? realpathSync(target) : target;
  for (const [name, dirs, copy] of [['merge base', baseDirs, base.cwd], ['without own tests', withoutDirs, without.cwd]]) {
    for (const dir of dirs) {
      // Catches a copy pointed at the working tree's target/: the base would get the change's cache.
      assert.ok(!inside(dir, realTarget) && !inside(dir, target), `the ${name} copy built into the working tree's target/ (${dir})`);
      // Catches today's lane and any build directory inside the throwaway copy, which perf deletes.
      assert.ok(!inside(dir, copy), `the ${name} copy built into ${dir}, inside the throwaway copy ${copy}`);
      // Catches a build directory removed at the end of the run.
      assert.ok(existsSync(dir), `the ${name} copy's build directory ${dir} is gone after the run`);
    }
  }

  const second = repo.preflight();
  assert.equal(second.status, 0, `the second preflight failed:\n${report(second)}`);
  assert.match(second.output, /^PASS perf \(/m, report(second));
  assert.doesNotMatch(second.output, /^(?:FAIL|BLOCKED) perf/m, report(second));
  // Catches today's lane (an empty target/ in each new copy) and a build directory deleted after a run.
  for (const name of sides) {
    const segment = side(second.segments, name);
    assert.deepEqual(built(segment), [], `the second preflight's ${name} run built dependencies again instead of reusing its build directory: ${describe(built(segment))}\n${report(second)}`);
  }
  const again = verdict(second.output);
  assert.ok(again?.base && again?.current, `no preflight verdict with both sides:\n${report(second)}`);
  assert.ok(again.current.cpuMs <= again.base.cpuMs * 1.5, `the second run's measured cpuMs ${again.current.cpuMs} is not within the 50% margin of the merge base's ${again.base.cpuMs}`);
});

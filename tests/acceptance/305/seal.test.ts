// #305.ec48d743: a test build with two writers of one array, a read of a later phase, a cycle or a
// missing dependency refuses to start, naming the canvas modules and arrays involved, and the
// shipped set seals clean. Each fault is a test canvas module behind its own Cargo feature
// (README: The test canvas modules); the refusal is one JSON line and exit 2 (README: Startup
// refusal). The wrong program is the base, which knows no build set and no seal.
import { describe, expect, it } from 'vitest';
import { DIGEST, CORE_VERSION, REFUSED_EXIT, sealed, sorted, startOutcome, startupRefusal, useBuilds, useEvidence, type Build } from './helpers.ts';

const TWO_WRITERS: Build = { set: 'core', with: ['test-two-writers'] };
const LATER_PHASE: Build = { set: 'core', with: ['test-later-phase'] };
const CYCLE: Build = { set: 'core', with: ['test-cycle'] };
const MISSING_DEP: Build = { set: 'core', with: ['test-missing-dep'] };
const SHIPPED: Build[] = [{ set: 'core' }, { set: 'r1' }, { set: 'r2' }, { set: 'full' }];

const builds = useBuilds([TWO_WRITERS, LATER_PHASE, CYCLE, MISSING_DEP, ...SHIPPED]);
const evidence = useEvidence();

describe('#305.ec48d743 a test build with a planted seal fault refuses to start, naming the canvas modules and arrays involved, and the shipped set seals clean', () => {
  it('#305.ec48d743 two writers of one array: test.w1 and test.w2 both own test.shared, so the build refuses to start naming both modules and the array', () => {
    const refusal = startupRefusal(builds.bin(TWO_WRITERS));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('two_writers');
    expect(sorted(refusal.modules), 'the refusal names both writers').toEqual(['test.w1', 'test.w2']);
    expect(sorted(refusal.arrays), 'the refusal names the array they both write').toEqual(['test.shared']);
  });

  it('#305.ec48d743 a read of a later phase: test.late reads test.late.after, written in render, from items, so the build refuses to start naming the module and the array', () => {
    const refusal = startupRefusal(builds.bin(LATER_PHASE));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('later_phase');
    expect(sorted(refusal.modules), 'the refusal names the reading module').toEqual(['test.late']);
    expect(sorted(refusal.arrays), 'the refusal names the array read before its phase').toEqual(['test.late.after']);
  });

  it('#305.ec48d743 a cycle: test.c1 reads test.c2.out and test.c2 reads test.c1.out in one phase, so the build refuses to start naming both modules and both arrays', () => {
    const refusal = startupRefusal(builds.bin(CYCLE));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('cycle');
    expect(sorted(refusal.modules), 'the refusal names both modules of the cycle').toEqual(['test.c1', 'test.c2']);
    expect(sorted(refusal.arrays), 'the refusal names both arrays of the cycle').toEqual(['test.c1.out', 'test.c2.out']);
  });

  it('#305.ec48d743 a missing dependency: test.orphan requires test.absent, which no build holds, so the build refuses to start naming both modules', () => {
    const refusal = startupRefusal(builds.bin(MISSING_DEP));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('missing_dependency');
    expect(sorted(refusal.modules), 'the refusal names the module and the dependency it lacks').toEqual(['test.absent', 'test.orphan']);
    expect(refusal.arrays, 'no array is involved').toEqual([]);
  });

  it('#305.ec48d743 a refused build answers nothing else: no reply to the scenario it was fed, and no warning level that lets it start', () => {
    for (const build of [TWO_WRITERS, LATER_PHASE, CYCLE, MISSING_DEP]) {
      const out = startOutcome(builds.bin(build));
      expect(out.started, `the build ${build.with![0]} doesn't start: ${JSON.stringify(out.line)}`).toBe(false);
      expect(out.status, `the build ${build.with![0]} exits ${REFUSED_EXIT}`).toBe(REFUSED_EXIT);
    }
  });

  it.each(SHIPPED)('#305.ec48d743 the shipped set seals clean in the $set build: it starts, its registry is sealed, its modules sorted by name, with core@version and a module-set digest', (build) => {
    const r = sealed(builds.bin(build), evidence());
    expect(['sealed', 'ready'], `the registry's state (${r.state}) is sealed or ready`).toContain(r.state);
    expect(r.build_set, 'the registry names its build set').toBe(build.set);
    expect(r.modules, 'the modules are listed in sorted name order').toEqual(sorted(r.modules));
    expect(new Set(r.modules).size, 'no module is listed twice').toBe(r.modules.length);
    expect(r.core, 'the registry carries core@version').toMatch(CORE_VERSION);
    expect(r.set_digest, 'the registry carries the module-set digest').toMatch(DIGEST);
    for (const [name, a] of Object.entries(r.arrays)) {
      expect(typeof a['owner'], `array ${name} has one owner`).toBe('string');
    }
  });

  it('#305.ec48d743 the sealed set is the same from one start to the next: the digest, the modules and the plan of two fresh full-build processes agree', () => {
    const first = sealed(builds.bin({ set: 'full' }), evidence());
    const second = sealed(builds.bin({ set: 'full' }), evidence());
    expect(second.set_digest, 'the module-set digest is the build\'s, not the run\'s').toBe(first.set_digest);
    expect(second.modules).toEqual(first.modules);
    expect(second.plan, 'the plan never depends on registration order or timing').toEqual(first.plan);
  });
});

// #388.c1a5581d, the build sets: the core and r1 build sets seal with exactly the canvas modules their lists
// name (core: text and look; r1: those and marks2d, data, graph, record, sheet and motion), and a test build
// that leaves look out, and one that leaves text out, each refuse startup, naming the module. The wrong
// programs: a set holding an extra or a missing module (named by the failure), and a build that starts
// without look or text. At the base the core set holds marks2d and motion, r1 lacks data, graph, record and
// sheet, and neither test feature exists, so those builds fail.
import { describe, expect, it } from 'vitest';
import { REGISTRY, SET_MODULES, none, registry, run, scenario, setFailures, sorted, startupRefusal, useBuilds, useEvidence, type Build } from './helpers.ts';

const CORE: Build = { set: 'core' };
const R1: Build = { set: 'r1' };
const NO_LOOK: Build = { set: 'core', with: ['test-leave-out-look'] };
const NO_TEXT: Build = { set: 'core', with: ['test-leave-out-text'] };
const builds = useBuilds([CORE, R1, NO_LOOK, NO_TEXT]);
const evidence = useEvidence();

/** The reason a build that leaves a module every build set holds out is refused with (README: Test builds). */
const LEFT_OUT = 'missing_core_module';

describe('#388.c1a5581d the core and r1 build sets seal with exactly the canvas modules their lists name; a build that leaves look or text out refuses startup, naming the module', () => {
  it('#388.c1a5581d the core build set seals with exactly text and look', () => {
    const reg = registry(run(builds.bin(CORE), scenario(evidence(), [REGISTRY]))[0]!);
    expect(reg.modules, 'the core build\'s canvas modules, sorted by name').toEqual([...SET_MODULES.core]);
    none(setFailures(reg, 'core'), 'the core build holds exactly text and look');
  }, 600_000);

  it('#388.c1a5581d the r1 build set seals with exactly text, look, marks2d, data, graph, record, sheet and motion', () => {
    const reg = registry(run(builds.bin(R1), scenario(evidence(), [REGISTRY]))[0]!);
    expect(reg.modules, 'the r1 build\'s canvas modules, sorted by name').toEqual([...SET_MODULES.r1]);
    none(setFailures(reg, 'r1'), 'the r1 build holds exactly its list');
  }, 600_000);

  it('#388.c1a5581d a test build that leaves look out (core,test-leave-out-look) refuses startup, naming look', () => {
    const refusal = startupRefusal(builds.bin(NO_LOOK));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe(LEFT_OUT);
    expect(sorted(refusal.modules), 'the refusal names exactly the module left out').toEqual(['look']);
  }, 600_000);

  it('#388.c1a5581d a test build that leaves text out (core,test-leave-out-text) refuses startup, naming text', () => {
    const refusal = startupRefusal(builds.bin(NO_TEXT));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe(LEFT_OUT);
    expect(sorted(refusal.modules), 'the refusal names exactly the module left out').toEqual(['text']);
  }, 600_000);
});

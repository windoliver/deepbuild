// Coverage reached (criterion 11), probes a backend can't make (12) and contributions to the core's arrays
// (13). At the base there is no `kit` call and no `test-kit-cover*`, `test-kit-snap*` or `test-kit-glyphs*`
// feature.
import { describe, expect, it } from 'vitest';
import {
  expectFailure, failuresIn, kit, moduleOf, partIn, show, str, useBuilds, useEvidence,
  type Build, type Case, type ModuleResult,
} from './helpers.ts';

const COVER: Build = { set: 'full', with: ['test-kit-cover'] };
const COVER_FIXED: Build = { set: 'full', with: ['test-kit-cover-fixed'] };
const SNAP: Build = { set: 'full', with: ['test-kit-snap'] };
const SNAP_OFF: Build = { set: 'full', with: ['test-kit-snap-off'] };
const GLYPHS: Build = { set: 'full', with: ['test-kit-glyphs'] };
const NO_BOX: Build = { set: 'full', with: ['test-kit-glyphs-no-box'] };
const builds = useBuilds([COVER, COVER_FIXED, SNAP, SNAP_OFF, GLYPHS, NO_BOX]);
const evidence = useEvidence();

const COVER_FIXTURE = 'parity/kernel/cover.board';
const W = 'test.kit.cover@1/params/w';
const GHOST = 'test.kit.cover@1/params/ghost';
const coverCases = (m: ModuleResult): Case[] => partIn(m, 'fixtures').cases.filter((c) => c.fixture === COVER_FIXTURE && c.declares !== undefined);

/** This test's check of the cover case: the failures it finds, empty when ghost reads INVALID, unreached. */
function ghostFailures(m: ModuleResult): string[] {
  const out: string[] = [];
  const cases = coverCases(m);
  if (cases.length === 0) out.push(`no case of ${COVER_FIXTURE} declares coverage`);
  for (const c of cases) {
    if (!c.declares!.fields.includes(GHOST)) out.push(`${c.case} doesn't declare ${GHOST}`);
    if (c.reached?.fields.includes(GHOST)) out.push(`${c.case} counts ${GHOST} as reached, though no fixture sets or reads it`);
    if (c.verdict !== 'INVALID') out.push(`${c.case} reads ${c.verdict}, not INVALID`);
    if (c.failure?.code !== 'unreached' || c.failure['field'] !== GHOST) out.push(`${c.case} doesn't name ${GHOST} unreached: ${show(c.failure)}`);
  }
  return out;
}

describe('#138.554b09da a case that declares a field its fixture never sets or reads reads INVALID, naming the field', () => {
  it('#138.554b09da test.kit.cover\'s case declaring ghost reads INVALID naming test.kit.cover@1/params/ghost; w is reached and ghost is not', () => {
    const r = kit(builds.bin(COVER), evidence(), { modules: ['test.kit.cover'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.cover');
    expect(ghostFailures(m)).toEqual([]);
    for (const c of coverCases(m)) expect(c.reached?.fields, `${c.case}: w is reached`).toContain(W);
    expect(['INVALID', 'FAIL'], 'the module does not pass').toContain(m.verdict);
  }, 1_800_000);

  it('#138.554b09da the same case declaring only w (test-kit-cover-fixed) passes', () => {
    const r = kit(builds.bin(COVER_FIXED), evidence(), { modules: ['test.kit.cover'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.cover');
    const cases = coverCases(m);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.declares!.fields).toEqual([W]);
      expect(c.verdict, show(c.raw)).toBe('PASS');
    }
  }, 1_800_000);

  it('#138.554b09da a kit that counts declared coverage as reached (counts_declared_as_reached) passes the case, and this test\'s check rejects it', () => {
    const r = kit(builds.bin(COVER), evidence(), { modules: ['test.kit.cover'], parts: ['fixtures'] }, { planted: 'counts_declared_as_reached' });
    const failures = ghostFailures(moduleOf(r, 'test.kit.cover'));
    expect(failures.length, 'the check catches the planted kit').toBeGreaterThan(0);
  }, 1_800_000);
});

const REFTEST = 'parity/kernel/snap-reftest.board';
const snapCases = (m: ModuleResult, backend: string): Case[] => partIn(m, 'fixtures').cases.filter((c) => c.fixture === REFTEST && c.backend === backend);

/** This test's check of the reftest on Vello CPU: the failures it finds, empty when it compared pixels and passed. */
function cpuReftestFailures(m: ModuleResult, wantPass: boolean): string[] {
  const cases = snapCases(m, 'vello_cpu');
  if (cases.length === 0) return [`${REFTEST} didn't run on Vello CPU`];
  const out: string[] = [];
  for (const c of cases) {
    const compared = c.raw['compared'] as { expected?: unknown; actual?: unknown } | undefined;
    if (!compared || typeof compared.expected !== 'string' || typeof compared.actual !== 'string') out.push(`${c.case} on Vello CPU shows no pixel comparison: ${show(c.raw)}`);
    else if (wantPass !== (compared.expected === compared.actual)) out.push(`${c.case}: the two renders ${compared.expected === compared.actual ? 'match' : 'differ'}`);
    if (c.verdict !== (wantPass ? 'PASS' : 'FAIL')) out.push(`${c.case} reads ${c.verdict} on Vello CPU`);
  }
  return out;
}

describe('#138.97027c5b a snapshot case on wgpu\'s noop backend reads BLOCKED naming the probe and passes on Vello CPU; with no backend that proves it the module fails', () => {
  it('#138.97027c5b test.kit.snap\'s reftest reads BLOCKED on noop, naming its probe, and passes on Vello CPU after comparing pixels', () => {
    const r = kit(builds.bin(SNAP), evidence(), { modules: ['test.kit.snap'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.snap');
    const noop = snapCases(m, 'noop');
    expect(noop.length, `${REFTEST} ran on noop`).toBeGreaterThan(0);
    for (const c of noop) {
      expect(c.verdict, `${c.case} on noop is BLOCKED, never a pass`).toBe('BLOCKED');
      expect(str(c.probe, `${c.case}.probe`), 'it names the probe noop can\'t make').toMatch(/pixel/);
    }
    expect(cpuReftestFailures(m, true)).toEqual([]);
  }, 1_800_000);

  it('#138.97027c5b with its Vello CPU run removed (backends: noop) the module fails the kit, unproved, naming the case and the probe', () => {
    const r = kit(builds.bin(SNAP), evidence(), { modules: ['test.kit.snap'], parts: ['fixtures'], backends: ['noop'] });
    const m = moduleOf(r, 'test.kit.snap');
    expect(m.verdict, 'no backend proved the case').toBe('FAIL');
    const caseName = snapCases(m, 'noop')[0]?.case;
    expect(caseName, 'the reftest ran on noop').toBeDefined();
    const f = expectFailure(failuresIn(m), 'unproved', { case: caseName! }, 'the unproved snapshot case');
    expect(str(f['probe'], 'unproved.probe')).toMatch(/pixel/);
  }, 1_800_000);

  it('#138.97027c5b the comparison runs: a render one code value off (test-kit-snap-off) fails the reftest on Vello CPU', () => {
    const r = kit(builds.bin(SNAP_OFF), evidence(), { modules: ['test.kit.snap'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.snap');
    expect(cpuReftestFailures(m, false)).toEqual([]);
    expect(m.verdict).toBe('FAIL');
  }, 1_800_000);

  it('#138.97027c5b a kit that skips the comparison and passes (skips_snapshot_comparison) passes the off render, and this test\'s check rejects it', () => {
    const r = kit(builds.bin(SNAP_OFF), evidence(), { modules: ['test.kit.snap'], parts: ['fixtures'] }, { planted: 'skips_snapshot_comparison' });
    const failures = cpuReftestFailures(moduleOf(r, 'test.kit.snap'), false);
    expect(failures.length, 'the check catches the planted kit').toBeGreaterThan(0);
  }, 1_800_000);
});

describe('#138.93adf6d7 a kind that draws text from the core\'s glyph atlas without contributing glyph boxes fails the contribution part, naming the kind', () => {
  it('#138.93adf6d7 test.kit.glyphs without its glyph-box contribution fails contribution, naming test.kit.glyphs@1', () => {
    const r = kit(builds.bin(NO_BOX), evidence(), { modules: ['test.kit.glyphs'], parts: ['contribution'] });
    const m = moduleOf(r, 'test.kit.glyphs');
    expect(m.verdict).toBe('FAIL');
    expectFailure(failuresIn(m, 'contribution'), 'contribution', { kind: 'test.kit.glyphs@1' }, 'the missing glyph boxes');
  }, 1_800_000);

  it('#138.93adf6d7 the same module with the contribution passes', () => {
    const r = kit(builds.bin(GLYPHS), evidence(), { modules: ['test.kit.glyphs'], parts: ['contribution'] });
    const p = partIn(moduleOf(r, 'test.kit.glyphs'), 'contribution');
    expect(p.verdict, show(p.failures)).toBe('PASS');
    expect(p.cases.some((c) => c.raw['kind'] === 'test.kit.glyphs@1'), 'the part checked the kind').toBe(true);
  }, 1_800_000);
});

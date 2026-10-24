// The kit holding itself honest: a comparison whose planted-mismatch twin passes is INVALID (criterion 4);
// a part's result comes from its own cases and every case it declares (9); every planted fault and clean twin
// raises exactly the codes it names (28). At the base there is no `kit` call and none of these features.
import { describe, expect, it } from 'vitest';
import {
  expectFailure, failuresIn, kit, matching, moduleOf, partIn, show, sorted, useBuilds, useEvidence,
  type Build, type Case, type ModuleResult, type Part,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const BLIND: Build = { set: 'full', with: ['test-kit-blind'] };
const BLIND_FIXED: Build = { set: 'full', with: ['test-kit-blind-fixed'] };
const NOISY: Build = { set: 'full', with: ['test-kit-noisy'] };
const NOISY_FIXED: Build = { set: 'full', with: ['test-kit-noisy-fixed'] };
const builds = useBuilds([FULL, BLIND, BLIND_FIXED, NOISY, NOISY_FIXED]);
const evidence = useEvidence();

const BLIND_FIXTURE = 'parity/kernel/blind-reftest.board';
const fixtureCases = (m: ModuleResult, name: string): Case[] => partIn(m, 'fixtures').cases.filter((c) => c.fixture === name);

describe('#138.028c56e3 a comparison whose planted-mismatch twin passes is INVALID, checked by a fixture that plants one', () => {
  it('#138.028c56e3 test.kit.blind\'s reftest, whose twin changes a param that draws nothing, reads INVALID naming the case', () => {
    const r = kit(builds.bin(BLIND), evidence(), { modules: ['test.kit.blind'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.blind');
    const cases = fixtureCases(m, BLIND_FIXTURE).filter((c) => c.backend === 'vello_cpu');
    expect(cases.length, `the kit compared ${BLIND_FIXTURE} on Vello CPU`).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.twin?.verdict, `${c.case}: the planted-mismatch twin ran and passed`).toBe('PASS');
      expect(c.verdict, `${c.case}: a comparison whose twin passes is INVALID, never PASS`).toBe('INVALID');
      expectFailure(failuresIn(m, 'fixtures'), 'twin_passed', { case: c.case }, 'the blind comparison');
    }
    expect(['INVALID', 'FAIL'], 'the module does not pass on a blind comparison').toContain(m.verdict);
  }, 1_800_000);

  it('#138.028c56e3 the same reftest with a twin that moves the box (test-kit-blind-fixed) fails its twin and passes', () => {
    const r = kit(builds.bin(BLIND_FIXED), evidence(), { modules: ['test.kit.blind'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.blind');
    const cases = fixtureCases(m, BLIND_FIXTURE).filter((c) => c.backend === 'vello_cpu');
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.twin?.verdict, `${c.case}: the twin fails`).toBe('FAIL');
      expect(c.verdict, `${c.case}: passes`).toBe('PASS');
    }
    expect(partIn(m, 'fixtures').verdict).toBe('PASS');
  }, 1_800_000);
});

describe('#138.5aef0e9f a part\'s result comes from its own cases, and it must run every case it declares', () => {
  it('#138.5aef0e9f a fuzzer that exits 0 after no sequences (fuzzer_runs_none) fails the module, naming patch_fuzz and the count', () => {
    const r = kit(builds.bin(FULL), evidence(), { modules: ['look'], parts: ['patch_fuzz'], sequences: 200 }, { planted: 'fuzzer_runs_none' });
    const m = moduleOf(r, 'look');
    const p = partIn(m, 'patch_fuzz');
    expect([p.exit, p.declared, p.ran], 'the part exits 0 having run none of its 200 sequences').toEqual([0, 200, 0]);
    expect(m.verdict, 'the module fails').toBe('FAIL');
    expectFailure(failuresIn(m), 'short_run', { part: 'patch_fuzz', declared: 200, ran: 0 }, 'the empty fuzzer');
  }, 1_800_000);

  it('#138.5aef0e9f a part that runs fewer cases than it declares (part_runs_half) fails the module, naming clean_rebuild and the count', () => {
    const r = kit(builds.bin(FULL), evidence(), { modules: ['look'], parts: ['clean_rebuild'], sequences: 200 }, { planted: 'part_runs_half' });
    const m = moduleOf(r, 'look');
    const p = partIn(m, 'clean_rebuild');
    expect([p.exit, p.declared, p.ran], 'the part exits 0 having run half').toEqual([0, 200, 100]);
    expect(m.verdict).toBe('FAIL');
    expectFailure(failuresIn(m), 'short_run', { part: 'clean_rebuild', declared: 200, ran: 100 }, 'the half run');
  }, 1_800_000);

  it('#138.5aef0e9f a part that exits 0 with a failed case in its results (exit_zero_with_failed_case) fails the module', () => {
    const r = kit(builds.bin(FULL), evidence(), { modules: ['look'], parts: ['schedule'] }, { planted: 'exit_zero_with_failed_case' });
    const m = moduleOf(r, 'look');
    const p = partIn(m, 'schedule');
    expect(p.exit, 'the part exits 0').toBe(0);
    const failed = p.cases.filter((c) => c.verdict === 'FAIL');
    expect(failed.length, 'its results hold a failed case').toBeGreaterThan(0);
    expect(p.verdict, 'the part\'s verdict comes from its cases, not its exit code').toBe('FAIL');
    expect(m.verdict, 'the module fails').toBe('FAIL');
    expectFailure(failuresIn(m), 'failed_case', { part: 'schedule', case: failed[0]!.case }, 'the exit-0 part');
  }, 1_800_000);

  it('#138.5aef0e9f the same parts, unplanted, run every case they declare and pass', () => {
    const r = kit(builds.bin(FULL), evidence(), { modules: ['look'], parts: ['patch_fuzz', 'clean_rebuild', 'schedule'], sequences: 200 });
    const m = moduleOf(r, 'look');
    for (const p of m.parts) expect([p.part, p.verdict, p.ran === p.declared && p.declared > 0], `${p.part}: ${show(p.failures)}`).toEqual([p.part, 'PASS', true]);
  }, 1_800_000);
});

/** The exact-codes check: every case naming its codes raised exactly them. Returns the failures. */
function exactCodeFailures(m: ModuleResult): string[] {
  const out: string[] = [];
  for (const p of m.parts) {
    for (const c of p.cases.filter((x) => x.expected_codes !== undefined)) {
      const want = sorted(c.expected_codes!);
      const got = sorted(c.raised_codes ?? []);
      if (JSON.stringify(want) !== JSON.stringify(got)) out.push(`${c.fixture ?? c.case} names ${show(want)} but raised ${show(got)}`);
      else if (c.verdict !== 'PASS' && c.verdict !== 'BLOCKED') out.push(`${c.fixture ?? c.case} raised exactly ${show(want)} yet reads ${c.verdict}`);
    }
  }
  return out;
}
/** The parts that run code fixtures: the fixtures themselves and the catalog's planted fixtures. */
const CODE_PARTS: Part[] = ['fixtures', 'catalog'];
const FAULT = 'parity/kernel/noisy-fault.board';
const TWIN = 'parity/kernel/noisy-twin.board';

describe('#138.0b7b2ee5 every planted fault, clean twin and code fixture names the exact codes it raises', () => {
  it('#138.0b7b2ee5 a planted fault that raises its code and also over_budget fails its case naming over_budget; a clean twin that raises a notice it doesn\'t name fails naming the notice', () => {
    const r = kit(builds.bin(NOISY), evidence(), { modules: ['test.kit.noisy'], parts: CODE_PARTS });
    const m = moduleOf(r, 'test.kit.noisy');
    expect(m.verdict, 'the noisy module fails the kit').toBe('FAIL');
    const all = failuresIn(m);
    const fault = expectFailure(all, 'unexpected_codes', { fixture: FAULT }, 'the planted fault');
    expect(fault['extra'], 'the fault names the code it raised but doesn\'t name').toEqual(['over_budget']);
    expect(fault['missing'], 'and misses none').toEqual([]);
    const twin = expectFailure(all, 'unexpected_codes', { fixture: TWIN }, 'the clean twin');
    expect(twin['extra'], 'the twin names the notice it raised').toEqual(['test.kit.noisy.hint']);
    const faultCase = m.parts.flatMap((p) => p.cases).find((c) => c.fixture === FAULT && c.expected_codes !== undefined);
    expect(faultCase?.verdict, 'the fault\'s case fails').toBe('FAIL');
  }, 1_800_000);

  it('#138.0b7b2ee5 the same fixtures raising exactly what they name (test-kit-noisy-fixed) pass', () => {
    const r = kit(builds.bin(NOISY_FIXED), evidence(), { modules: ['test.kit.noisy'], parts: CODE_PARTS });
    const m = moduleOf(r, 'test.kit.noisy');
    expect(exactCodeFailures(m)).toEqual([]);
    expect(matching(failuresIn(m), 'unexpected_codes'), 'no case raised a code it doesn\'t name').toEqual([]);
    expect(m.verdict, `the module passes: ${show(failuresIn(m))}`).toBe('PASS');
  }, 1_800_000);

  it('#138.0b7b2ee5 a kit that checks only for the expected code (checks_expected_code_only) passes the fault, and this test\'s check rejects it', () => {
    const r = kit(builds.bin(NOISY), evidence(), { modules: ['test.kit.noisy'], parts: CODE_PARTS }, { planted: 'checks_expected_code_only' });
    const m = moduleOf(r, 'test.kit.noisy');
    const failures = exactCodeFailures(m);
    expect(failures.some((f) => f.includes(FAULT) && f.includes('over_budget')), `the check catches the planted kit, naming over_budget: ${show(failures)}`).toBe(true);
  }, 1_800_000);
});

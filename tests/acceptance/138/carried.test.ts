// Carried state (criterion 8) and late entries (10). `test.kit.carry` steps at 60 Hz with {count, hits} and
// checkpoints before steps 10, 20, …; its planted twin's checkpoint drops `hits`, so a seek from step 10's
// checkpoint first differs from a straight run at step 10. `test.kit.tally` reads `bump` entries and makes
// occurrences; its fixture declares one entry at step 20 (a checkpoint step), which the late-entry part plays
// arriving 1 to 8 steps late; one planted twin keeps the replaced steps' occurrences, the other skips an entry
// at the restored step, and both first differ from the on-time run at step 20 (README: Readings). At the base
// there is no `kit` call and no `test-kit-carry*` or `test-kit-tally*` feature.
import { describe, expect, it } from 'vitest';
import {
  ROLLBACK_WINDOW, failuresIn, kit, matching, moduleOf, num, obj, partIn, show, useBuilds, useEvidence,
  type Build,
} from './helpers.ts';

const CARRY: Build = { set: 'full', with: ['test-kit-carry'] };
const DROPS: Build = { set: 'full', with: ['test-kit-carry-drops-hits'] };
const TALLY: Build = { set: 'full', with: ['test-kit-tally'] };
const KEEPS: Build = { set: 'full', with: ['test-kit-tally-keeps-occurrence'] };
const SKIPS: Build = { set: 'full', with: ['test-kit-tally-skips-restored'] };
const builds = useBuilds([CARRY, DROPS, TALLY, KEEPS, SKIPS]);
const evidence = useEvidence();

describe('#138.bf59b612 a checkpoint that leaves out one counter fails the carried-state part, naming the module and the first step whose hash differs', () => {
  it('#138.bf59b612 test.kit.carry with hits left out of its checkpoint fails carried_state, step_hash, naming test.kit.carry and step 10', () => {
    const r = kit(builds.bin(DROPS), evidence(), { modules: ['test.kit.carry'], parts: ['carried_state'] });
    const m = moduleOf(r, 'test.kit.carry');
    expect(m.verdict).toBe('FAIL');
    const failures = matching(failuresIn(m, 'carried_state'), 'step_hash', { module: 'test.kit.carry' });
    expect(failures.length, `a step_hash failure naming test.kit.carry: ${show(failuresIn(m, 'carried_state'))}`).toBeGreaterThan(0);
    expect(Math.min(...failures.map((f) => num(f['step'], 'step_hash.step'))), 'the first step whose hash differs from a straight run is step 10').toBe(10);
  }, 1_800_000);

  it('#138.bf59b612 the same module with the counter in its checkpoint passes carried_state, seeking from every checkpoint', () => {
    const r = kit(builds.bin(CARRY), evidence(), { modules: ['test.kit.carry'], parts: ['carried_state'] });
    const p = partIn(moduleOf(r, 'test.kit.carry'), 'carried_state');
    expect(p.verdict, show(p.failures)).toBe('PASS');
    expect(p.cases.length, 'a seek from each of the five checkpoints (at least)').toBeGreaterThanOrEqual(5);
  }, 1_800_000);
});

describe('#138.bd29bce3 late entries: a module that keeps a replaced step\'s occurrence, or skips an entry at the restored step, fails the late-entry part while passing carried state', () => {
  it.each([
    ['test-kit-tally-keeps-occurrence', KEEPS],
    ['test-kit-tally-skips-restored', SKIPS],
  ] as const)('#138.bd29bce3 %s fails late_entry naming test.kit.tally and step 20, the first step that differs from the on-time run, and passes carried_state', (_name, build) => {
    const r = kit(builds.bin(build), evidence(), { modules: ['test.kit.tally'], parts: ['carried_state', 'late_entry'] });
    const m = moduleOf(r, 'test.kit.tally');
    expect(partIn(m, 'carried_state').verdict, `it passes the carried-state part: ${show(partIn(m, 'carried_state').failures)}`).toBe('PASS');
    expect(partIn(m, 'late_entry').verdict, 'it fails the late-entry part').toBe('FAIL');
    expect(m.verdict).toBe('FAIL');
    const failures = matching(failuresIn(m, 'late_entry'), 'late_entry', { module: 'test.kit.tally' });
    expect(failures.length, `a late_entry failure naming test.kit.tally: ${show(failuresIn(m, 'late_entry'))}`).toBeGreaterThan(0);
    expect(Math.min(...failures.map((f) => num(f['step'], 'late_entry.step'))), 'the first step that differs from the on-time run is the entry\'s step, 20').toBe(20);
  }, 1_800_000);

  it(`#138.bd29bce3 test.kit.tally fixed passes both parts, its late entry arriving 1 to ${ROLLBACK_WINDOW} steps after step 20`, () => {
    const r = kit(builds.bin(TALLY), evidence(), { modules: ['test.kit.tally'], parts: ['carried_state', 'late_entry'] });
    const m = moduleOf(r, 'test.kit.tally');
    expect(partIn(m, 'carried_state').verdict).toBe('PASS');
    const late = partIn(m, 'late_entry');
    expect(late.verdict, show(late.failures)).toBe('PASS');
    const lags = late.cases.map((c) => {
      const e = obj(c.raw['entry'], `${c.case}.entry`);
      expect(num(e['step'], 'entry.step'), 'the declared entry\'s step').toBe(20);
      return num(e['arrived'], 'entry.arrived') - 20;
    });
    expect([...new Set(lags)].sort((a, b) => a - b), 'the entry arrives 1 to 8 steps late').toEqual(Array.from({ length: ROLLBACK_WINDOW }, (_, i) => i + 1));
    expect(matching(failuresIn(m), 'late_entry')).toEqual([]);
  }, 1_800_000);
});

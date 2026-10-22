// AC3 and AC4 for check.kind@1: the runner returns only the closed run outcomes, never a verdict, names the
// mask, and takes testsRun and each failure's place from the tool's own report; the four planted runners each
// raise their check-catalog code; the fixture suite reads data/expected.json outside the spec's declared paths,
// a runner that records only the declared paths as read fails the kit naming the file, and after a change to
// that file alone the PASS reads stale.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stalePaths } from '../../../packages/conformance/src/index.ts';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import {
  CHECK_FIXTURES, CHECK_PLANTED_CODES, checkFixture, checkKit, clean, declaredOnlyRunner, EXPECTED_JSON, failing, notPassing, part, planted,
  PLANTED, run, runFixture, RUN_OUTCOMES, RUNS, sameSet, VERDICTS,
} from './helpers.ts';

const kit = checkKit();
const CHECK_KIND = kit.slot;
const result = (read: string[]): CheckResult => ({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read, mask: null });

describe('AC3 the check.kind@1 runner returns only the closed run outcomes, never a verdict, names the mask, and takes testsRun and each failure\'s place from the tool\'s own report', () => {
  it('AC3 the kit ships the six fixture suites: a known-pass, a known-fail, a fail-elsewhere, a ran-nothing, a masked-exit and a past-deadline', () => {
    for (const word of CHECK_FIXTURES) {
      const f = checkFixture(kit, word);
      expect(existsSync(f.input.checkout), `${f.id}'s checkout ${f.input.checkout} exists`).toBe(true);
      expect(f.input.spec.kind, `${f.id}'s spec names the kind the reference runner serves`).toBe(clean(kit).kind);
    }
  });

  it('AC3 every fixture\'s result is a closed run outcome, never one of the five verdicts, with no verdict field', async () => {
    const fill = clean(kit);
    for (const word of CHECK_FIXTURES) {
      const f = checkFixture(kit, word);
      const r = await runFixture(fill, f);
      expect(RUN_OUTCOMES, `${f.id}: ${r.outcome} is a run outcome`).toContain(r.outcome);
      expect(VERDICTS, `${f.id}: never a verdict`).not.toContain(r.outcome as string);
      expect('verdict' in r, `${f.id}: the runner reports no verdict`).toBe(false);
      expect(Number.isInteger(r.testsRun) && r.testsRun >= 0, `${f.id}: testsRun is a count`).toBe(true);
      expect(Array.isArray(r.failures) && Array.isArray(r.read) && Array.isArray(r.evidence)).toBe(true);
      expect(r.mask === null || (typeof r.mask === 'string' && r.mask.length > 0), `${f.id}: mask is null or names the mask`).toBe(true);
    }
  }, 120_000);

  it('AC3 the known-pass suite passes with its tests counted; the known-fail suite fails with each failure\'s file, line, stack and whether it was the framework\'s assertion', async () => {
    const fill = clean(kit);
    const pass = await runFixture(fill, checkFixture(kit, 'known-pass'));
    expect(pass.outcome).toBe('passed');
    expect(pass.testsRun).toBeGreaterThan(0);
    expect(pass.failures).toEqual([]);
    expect(pass.mask).toBeNull();
    const fail = await runFixture(fill, checkFixture(kit, 'known-fail'));
    expect(fail.outcome).toBe('failed');
    expect(fail.testsRun).toBeGreaterThan(0);
    expect(fail.failures.length).toBeGreaterThan(0);
    for (const failure of fail.failures) {
      expect(typeof failure.file === 'string' && failure.file.length > 0, 'a failure names its file').toBe(true);
      expect(Number.isInteger(failure.line) && failure.line >= 1, 'a failure names its line').toBe(true);
      expect(failure.stack === null || typeof failure.stack === 'string', 'a caught error\'s stack, or null').toBe(true);
      expect(typeof failure.assertion, 'whether it was the framework\'s assertion failure').toBe('boolean');
    }
    expect(fail.failures.some((f) => f.assertion), 'the known-fail suite fails at an assertion').toBe(true);
  }, 120_000);

  it('AC3 the fail-elsewhere suite fails outside any assertion, so its failure is not reported as the framework\'s; the ran-nothing suite ran nothing', async () => {
    const fill = clean(kit);
    const elsewhere = await runFixture(fill, checkFixture(kit, 'fail-elsewhere'));
    expect(elsewhere.outcome).not.toBe('passed');
    expect(elsewhere.failures.length).toBeGreaterThan(0);
    expect(elsewhere.failures.some((f) => !f.assertion), 'a failure before the first assertion is not an assertion failure').toBe(true);
    for (const f of elsewhere.failures.filter((x) => !x.assertion)) expect(typeof f.stack, 'a caught error carries its stack').toBe('string');
    const nothing = await runFixture(fill, checkFixture(kit, 'ran-nothing'));
    expect(nothing.outcome).toBe('ran_nothing');
    expect(nothing.testsRun).toBe(0);
  }, 120_000);

  it('AC3 the masked-exit suite\'s result names the mask; the past-deadline suite overran', async () => {
    const fill = clean(kit);
    const masked = await runFixture(fill, checkFixture(kit, 'masked-exit'));
    expect(typeof masked.mask, 'the mask is named').toBe('string');
    expect((masked.mask ?? '').length).toBeGreaterThan(0);
    expect(masked.outcome).not.toBe('passed');
    const late = await runFixture(fill, checkFixture(kit, 'past-deadline'));
    expect(late.outcome).toBe('overran');
  }, 120_000);

  it('AC3 the four planted runners each raise their check-catalog code (check.code@1) and fail the kit with their own message', async () => {
    for (const name of PLANTED[CHECK_KIND]!) {
      const p = planted(kit, name);
      expect(p.codes, `${name} names ${CHECK_PLANTED_CODES[name]}`).toContain(CHECK_PLANTED_CODES[name]!);
      const report = await run(kit, p.fill, { seed: 1 });
      const named = failing(report).filter((c) => c.message.includes(p.message));
      expect(named.length, `${name}: a FAIL carries "${p.message}" (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
      expect(named.some((c) => c.codes.includes(CHECK_PLANTED_CODES[name]!)), `${name}: the FAIL raises ${CHECK_PLANTED_CODES[name]}`).toBe(true);
    }
  }, 600_000);

  it('AC3 the crashed-suite runner reports passed with 12 tests on the fail-elsewhere suite, which the kit refuses; the reference runner does not', async () => {
    const crashed = planted(kit, 'crashed-suite');
    const f = checkFixture(kit, 'fail-elsewhere');
    const wrong = await runFixture(crashed.fill, f);
    expect(wrong.outcome).toBe('passed');
    expect(wrong.testsRun).toBe(12);
    const right = await runFixture(clean(kit), f);
    expect(right.outcome).not.toBe('passed');
  }, 120_000);
});

describe('AC4 the fixture suite reads data/expected.json outside the spec\'s declared paths; a runner that records only the declared paths fails the kit naming the file; a change to that file alone makes the PASS stale', () => {
  const pass = checkFixture(kit, 'known-pass');

  it('AC4 the known-pass suite\'s checkout holds data/expected.json, and the spec\'s declared paths don\'t name it', () => {
    expect(existsSync(join(pass.input.checkout, EXPECTED_JSON)), `${pass.input.checkout}/${EXPECTED_JSON}`).toBe(true);
    expect(pass.input.spec.inputs.length, 'the spec declares paths').toBeGreaterThan(0);
    expect(pass.input.spec.inputs.some((p) => p === EXPECTED_JSON || p.startsWith('data/') || p.startsWith('data')), `declared paths ${pass.input.spec.inputs} lie outside data/`).toBe(false);
  });

  it('AC4 the reference runner records data/expected.json among the files the suite read, so a change to it alone reads stale', async () => {
    const r = await runFixture(clean(kit), pass);
    expect(r.outcome).toBe('passed');
    expect(r.read, `read set ${r.read}`).toContain(EXPECTED_JSON);
    expect(stalePaths(r, [EXPECTED_JSON])).toEqual([EXPECTED_JSON]);
    expect(stalePaths(r, ['README.md']), 'a file the run never read leaves the PASS current').toEqual([]);
  }, 120_000);

  it('AC4 a runner that records only the declared paths as read fails the kit, naming the file', async () => {
    const report = await run(kit, declaredOnlyRunner(clean(kit)), { seed: 1 });
    expect(report.verdict).not.toBe('PASS');
    const named = failing(report).filter((c) => c.message.includes(EXPECTED_JSON));
    expect(named.length, `a FAIL names ${EXPECTED_JSON} (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
  }, 120_000);

  it('AC4 for any read set and any changed files, the stale paths are exactly the changed files the run read (1,000 cases)', () => {
    const path = fc.constantFrom('src/cart.ts', 'test/cart.test.ts', EXPECTED_JSON, 'data/rates.json', 'package.json', 'README.md');
    fc.assert(fc.property(fc.uniqueArray(path), fc.uniqueArray(path), (read, changed) => {
      const stale = stalePaths(result(read), changed);
      expect(sameSet(stale, changed.filter((p) => read.includes(p))), `read ${read}, changed ${changed}: stale ${stale}`).toBe(true);
    }), RUNS);
  });

  it('AC4 (wrong program) the declared-only runner passes the known-pass suite yet misses the stale read, and the kit\'s fixed part is what catches it', async () => {
    const wrong = declaredOnlyRunner(clean(kit));
    const r = await runFixture(wrong, pass);
    expect(r.outcome).toBe('passed');
    expect(r.read).not.toContain(EXPECTED_JSON);
    expect(stalePaths(r, [EXPECTED_JSON]), 'after a change to that file alone, the wrong runner\'s PASS reads current').toEqual([]);
    expect(() => expect(stalePaths(r, [EXPECTED_JSON])).toEqual([EXPECTED_JSON])).toThrow();
    const report = await run(kit, wrong, { seed: 1 });
    // The assertion the reference fill passes (kits.test.ts) fails on the declared-only runner, and what it was
    // fed names the file. Chai prints a non-empty array as `[ Array(n) ]`, so the content is checked directly.
    const caught = notPassing(part(report, 'fixed'));
    expect(() => expect(caught, 'the reference fill passes').toEqual([])).toThrow();
    expect(caught.join('\n'), 'the failure names the file').toMatch(new RegExp(EXPECTED_JSON.replace('.', '\\.')));
  }, 120_000);
});

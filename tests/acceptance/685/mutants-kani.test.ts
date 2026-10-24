// AC7 on the Kani fixture: a theorem whose proof checks on every mutant of its target, the harness stating
// `total(x) == total(x)` (f x = f x), gives INVALID, naming the theorem; the fixture's real harness fails on at least
// one cargo-mutants mutant of `total`, which is listed.
import { afterAll, describe, expect, it } from 'vitest';
import type { MutantReport } from '../../../packages/proof/src/index.ts';
import {
  checkout, cleanup, context, expectCantFail, judge, KANI_DEADLINE, KANI_TEST, kaniSpec, mutantsOf, once, plugin, requireKani, requireMutants,
  runProof,
} from './helpers.ts';

afterAll(cleanup);

const APPEND = 'proofs::total_append';
const SELF = 'proofs::total_self';
const spec = kaniSpec([APPEND, SELF]);
const run = once(() => runProof(spec, checkout('kani')));
const report = once(async () => {
  const p = await plugin();
  requireKani();
  requireMutants();
  return await p.mutants(spec, context(checkout('kani'), KANI_DEADLINE));
});

describe('AC7 a Kani harness that checks on every mutant of its target can\'t fail, and its check is INVALID, naming it', () => {
  it('AC7 both harnesses verify on the fixture itself, so whatever the mutants show is theirs alone', async () => {
    const r = await run();
    expect(r.outcome, r.reasons.join(' | ')).toBe('passed');
    expect(r.testsRun).toBe(2);
  }, KANI_TEST);

  it('AC7 proofs::total_self (f x = f x) checks on every mutant of total: none kills it, and the check is INVALID, naming it', async () => {
    const m = await report();
    const self = mutantsOf(m, SELF);
    expect(self.killed, 'no mutant of total fails f x = f x').toEqual([]);
    expect(self.survived.length, 'the mutants it checked on').toBeGreaterThan(0);
    expectCantFail(await run(), m, 'total_self', 'f x = f x');
  }, KANI_TEST);

  it('AC7 the real harness proofs::total_append fails on at least one mutant of total, listed by its place in src/lib.rs, and the check doesn\'t name it as one that can\'t fail', async () => {
    const m = await report();
    const append = mutantsOf(m, APPEND);
    expect(append.killed.length, `the mutants that kill total_append: ${JSON.stringify(append)}`).toBeGreaterThan(0);
    for (const mutant of append.killed) expect(mutant, 'each listed mutant names its place in the target').toMatch(/src\/lib\.rs:\d+/);
    expect(m.cantFail ?? '', 'the real harness can fail').not.toMatch(/total_append\b/);
  }, KANI_TEST);

  it('AC7 (wrong program) a mutation check that runs no mutant passes f x = f x and fails the assertion above', async () => {
    const [r, m] = [await run(), await report()];
    expectCantFail(r, m, 'total_self', 'the plug-in');
    const none: MutantReport = { theorems: [], cantFail: null };
    expect(judge(r, { cantFail: none.cantFail }).outcome, 'with no mutant run, f x = f x passes').toBe('PASS');
    expect(() => expectCantFail(r, none, 'total_self', 'no mutants')).toThrow(/no mutants: the mutation check names total_self/);
  }, KANI_TEST);
});

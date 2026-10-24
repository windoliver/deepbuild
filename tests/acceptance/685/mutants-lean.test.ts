// AC7 on the Lean fixture: a theorem whose proof checks on every mutant of its target, `total_self : total a =
// total a` (f x = f x), gives INVALID, naming the theorem; the fixture's real theorem `total_append` fails on at
// least one mutant of `total`'s lines, which is listed.
import { afterAll, describe, expect, it } from 'vitest';
import { checkout, cleanup, context, expectCantFail, LEAN_DEADLINE, LEAN_TEST, leanSpec, mutantsOf, once, plugin, requireLean, runProof } from './helpers.ts';

afterAll(cleanup);

const spec = leanSpec(['total_append', 'total_self']);
const run = once(() => runProof(spec, checkout('lean')));
const report = once(async () => {
  const p = await plugin();
  requireLean();
  return await p.mutants(spec, context(checkout('lean'), LEAN_DEADLINE));
});

describe('AC7 a Lean theorem that checks on every mutant of its target can\'t fail, and its check is INVALID, naming it', () => {
  it('AC7 both theorems check on the fixture itself through comparator', async () => {
    const r = await run();
    expect(r.outcome, r.reasons.join(' | ')).toBe('passed');
    expect(r.testsRun).toBe(2);
  }, LEAN_TEST);

  it('AC7 total_self (f x = f x) checks on every mutant of total: none kills it, and the check is INVALID, naming it', async () => {
    const m = await report();
    const self = mutantsOf(m, 'total_self');
    expect(self.killed, 'no mutant of total fails f x = f x').toEqual([]);
    expect(self.survived.length, 'the mutants it checked on').toBeGreaterThan(0);
    expectCantFail(await run(), m, 'total_self', 'f x = f x');
  }, LEAN_TEST);

  it('AC7 the real theorem total_append fails on at least one mutant of total, listed by its place in Fixture/Total.lean, and the check doesn\'t name it as one that can\'t fail', async () => {
    const m = await report();
    const append = mutantsOf(m, 'total_append');
    expect(append.killed.length, `the mutants that kill total_append: ${JSON.stringify(append)}`).toBeGreaterThan(0);
    for (const mutant of append.killed) expect(mutant, 'each listed mutant names its place in the target').toMatch(/Fixture\/Total\.lean:\d+/);
    expect(m.cantFail ?? '', 'the real theorem can fail').not.toMatch(/total_append\b/);
  }, LEAN_TEST);
});

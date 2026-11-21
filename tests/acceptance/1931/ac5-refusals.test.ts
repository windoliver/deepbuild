// Criterion 5: an `inverse_square` with `min_distance: 0`, a `lennard_jones` with `sigma: 0` and a `lennard_jones`
// over 257 bodies are each refused at check before any step runs, naming the field and the value, or the force and the
// count 257 with `over_budget`.
import { describe, expect, test } from 'vitest';
import {
  AC, APART, BOND, LEFT, MIN_DISTANCE, MOON, PULL, SIGMA, TIMEOUT, acceptedFailures, ask, bake, check, codeRefusalFailures, crowdWorld,
  fieldRefusalFailures, namesNumber, orbitWorld, pairWorld, prebuild, show, unsteppedFailures, type JsonObject,
} from './helpers.ts';

prebuild(['release']);

/**
 * One refusal, read three ways in one process: the check of the world as the criterion writes it, the check of the same
 * world with a legal value in its place, and a bake of the refused world, which must end before a step runs.
 */
function refused(wrong: JsonObject, legal: JsonObject, read: string, what: string, judge: (reply: JsonObject, what: string) => string[]): string[] {
  const run = ask([check(wrong), check(legal), bake(wrong, 1, [read])]);
  expect(run.problem, `${run.what} answers`).toBe('');
  console.log(`${what}: ${show(run.replies[0]!['issues'])}`);
  return [
    ...judge(run.replies[0]!, what),
    // The refusal is the value's: the same world with a legal one is taken.
    ...acceptedFailures(run.replies[1]!, `${what}'s world with a legal value`),
    // Before any step runs: its bake is refused the same way, and answers no state and no step's hash.
    ...judge(run.replies[2]!, `${what}, baked,`),
    ...unsteppedFailures(run.replies[2]!, what),
  ];
}

describe(`${AC[5]} a force law's illegal fields and a lennard_jones over more than 256 bodies are refused at check before any step runs`, () => {
  test(`${AC[5]} an inverse_square with min_distance 0 is refused naming the field and the value, and with min_distance ${MIN_DISTANCE} it is taken`, () => {
    const failures = refused(orbitWorld({ minDistance: 0 }), orbitWorld(), MOON, 'an inverse_square with min_distance 0',
      (reply, what) => fieldRefusalFailures(reply, { force: PULL, field: 'min_distance', actual: 0 }, what));
    expect(failures, `min_distance 0:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[5]} a lennard_jones with sigma 0 is refused naming the field and the value, and with sigma ${SIGMA} it is taken`, () => {
    const failures = refused(pairWorld(APART, { sigma: 0 }), pairWorld(APART), LEFT, 'a lennard_jones with sigma 0',
      (reply, what) => fieldRefusalFailures(reply, { force: BOND, field: 'sigma', actual: 0 }, what));
    expect(failures, `sigma 0:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[5]} a lennard_jones over 257 bodies is refused with over_budget naming the force ${BOND} and the count 257, and over 256 bodies it is taken`, () => {
    const failures = refused(crowdWorld(257), crowdWorld(256), 'atom000', 'a lennard_jones over 257 bodies',
      (reply, what) => codeRefusalFailures(reply, { code: 'over_budget', force: BOND, more: (i) => namesNumber(i, 257), saying: 'the count 257' }, what));
    expect(failures, `257 bodies:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});

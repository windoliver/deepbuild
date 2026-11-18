// #251.2e102906, two of its clauses: "A vehicle body in a 2D world, with a follow channel or with a ninth wheel is
// refused at check, naming the field", and "a planted check that counts only the wheels passes the 2D world and fails,
// naming the field". Its other clauses (caps() and the test backend, Rapier types in the public items) are the first
// draft's (../251/ac6-refusals.test.ts) and aren't redrafted here.
//
// One deep-physics process checks five worlds (README: The worlds): the issue's four-wheeled car and an eight-wheeled
// one, each in a 3D world and admitted; the car's world with `dimensions: 2`, the car with a follow channel and the
// eight-wheeled car with a ninth wheel, each refused by an error issue naming its field (README: Readings). The twin
// `check_counts_wheels_only` must still refuse the ninth wheel, and the same judge must fail it on the 2D world, naming
// the field.
import { describe, expect, it } from 'vitest';
import { ID, TIMEOUT, TWIN, caught, checkAll, judge, none, prebuild } from './helpers.ts';

prebuild();

describe(`${ID} a vehicle body is refused at check in a 2D world, with a follow channel or with a ninth wheel, naming the field`, () => {
  it(`${ID} (fields) the car and an eight-wheeled car are admitted; in a 2D world, with a follow channel or with a ninth wheel the vehicle body is refused, naming the field`, () => {
    none(judge(checkAll()), 'the right vehicle bodies are admitted and each wrong one is refused, naming its field');
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted check that counts only the wheels passes the 2D world and fails, naming the field`, () => {
    const failures = judge(checkAll(TWIN));
    caught(failures, `${TWIN}, judged on the vehicle worlds`);
    const said = `${TWIN}'s failures: ${failures.join(' | ')}`;
    expect(failures.some((f) => f.startsWith('the 2D world:') && f.includes('bodies/kart/kind')), `${said}: one is the 2D world's, naming the field bodies/kart/kind`).toBe(true);
    expect(failures.filter((f) => f.startsWith('the ninth wheel:')), `${said}: it counts the wheels, so it refuses the ninth`).toEqual([]);
  }, TIMEOUT);
});

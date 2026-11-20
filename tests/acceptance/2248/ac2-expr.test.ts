// #2248.7a7a91ac: An output with `expr: "0.5 * m * v * v"` over the reads `v` (the ball's speed) and `m` (its mass),
// `unit: J`, reads the ball's kinetic energy at 1 s, ½ × 1 × 9.81², within 0.5%, and an `expr` that names no read is
// refused at check, naming the output.
//
// The dropped ball's world (helpers' `dropWorld`) with the output `ke` (README: An output's `expr`): baked by
// `deep-physics`, its series read from `outputs.series.ke`, one number a frame at a frame a step; and checked, with
// its reads and without them.
import { describe, expect, test } from 'vitest';
import {
  BALL, CRITERIA, EXPR, G, KE, MASS, PER_STEP, SECOND, TIMEOUT, bake, check, dropWorld, errorsOf, keOutput, keOutputWithoutReads, list,
  namesOutput, numbersOf, physics, prebuild, statesOf, tolds,
} from './helpers.ts';

prebuild(['release']);

const ID = CRITERIA[2];
/** The issue's bound on the energy. */
const WITHIN = 0.005;

describe(`${ID} an output's expr over its named reads, with its unit`, () => {
  test(`${ID} an output with expr "0.5 * m * v * v" over the reads v (the ball's speed) and m (its mass), unit J, reads the ball's kinetic energy at 1 s, ½ × 1 × 9.81², within 0.5%`, () => {
    const want = 0.5 * MASS * G * G;
    const [baked] = physics([bake(dropWorld({ [KE]: keOutput() }), SECOND, { frame_rate: PER_STEP })]);
    const what = 'the dropped ball\'s energy by expr';
    const { values, problems } = numbersOf(baked, KE, what);
    console.log(`${what}: outputs.series.${KE} holds ${values.length} values; at 0.5 s ${values[SECOND / 2] ?? 'none'} J, at 1 s ${values[SECOND] ?? 'none'} J; ½ × 1 × 9.81² = ${want.toFixed(4)} J`);
    expect(problems, `${what}: the output's series is read:${list(problems)}`).toEqual([]);
    expect(values.length, `${what}: one value a frame at a frame a step, the built state's first`).toBe(SECOND + 1);
    const atOne = values[SECOND]!;
    expect(Math.abs(atOne - want) <= WITHIN * want, `${what}: at 1 s the output reads ${atOne} J; ½ × 1 × 9.81² = ${want.toFixed(3)} J within 0.5%`).toBe(true);
    // It reads the ball's energy, not one number: after every step, half its mass times its speed squared, 0 as built.
    const states = statesOf(baked!, BALL, what);
    const failures = values.flatMap((e, k) => {
      const speed = Math.hypot(...states[k]!.linear);
      const energy = 0.5 * MASS * speed * speed;
      return Math.abs(e - energy) <= WITHIN * energy + 1e-9 ? [] : [`after step ${k} the output reads ${e} J; the ball, at ${speed.toFixed(4)} m/s, holds ${energy.toFixed(4)} J`];
    });
    expect(failures, `${what}: at every step the output is ½ × m × v² of the ball's own speed:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${ID} an expr that names no read is refused at check, naming the output, where the same expr over the reads it names is taken`, () => {
    const [named, unnamed] = physics([check(dropWorld({ [KE]: keOutput() })), check(dropWorld({ [KE]: keOutputWithoutReads() }))]);
    const taken = errorsOf(named, 'the expr over its reads v and m');
    const refused = errorsOf(unnamed, 'the expr that names no read');
    console.log(`"${EXPR}" over the reads v and m: ${tolds(taken.errors).join('; ') || 'no error'}`);
    console.log(`"${EXPR}" on an output with no reads: ${tolds(refused.errors).join('; ') || 'no error'}`);
    expect([...taken.unread, ...refused.unread], 'both worlds were checked').toEqual([]);
    // The refusal below is for the read the expr doesn't name only if the expr itself is run: with its reads it is taken.
    expect(tolds(taken.errors), `"${EXPR}" over the reads it names, v and m, is taken at check`).toEqual([]);
    const naming = refused.errors.filter((i) => namesOutput(i, KE));
    expect(naming.length, `"${EXPR}" on an output that declares no read is refused at check by an error issue naming the output ${KE}; its error issues:${list(tolds(refused.errors))}`).toBeGreaterThan(0);
  }, TIMEOUT);
});

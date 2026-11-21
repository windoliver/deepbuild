// Criterion 6: a world that writes no `length_unit` gives step hashes byte-identical to the merge base's. Two worlds
// that differ only in `length_unit` have different bake keys. On a test backend whose `caps()` say it scales no
// lengths, `length_unit: 0.01` is refused, naming the field and the backend, and a planted check that reads only the
// field's range accepts it and fails.
import { describe, expect, test } from 'vitest';
import {
  AC, FIELD, NO_LENGTH_UNIT, REFERENCE, TIMEOUT, acceptedFailures, ask, askBase, backendOf, bake, check, hashesOf, keyOf,
  prebuild, refusal, refusedFailures, sameFailures, stack, withBase, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['release', 'test']);
withBase();

const PLANTED: Planted = 'check_reads_range_only';
/** Criterion 2's stack, the same document but for what it writes at `solver.length_unit`; `null` writes none. */
const world = (lengthUnit: number | null): JsonObject => stack({ lengthUnit }).world;
const STEPS = stack().steps;

describe(`${AC[6]} unwritten the world runs as before, the bake key sees the field, and a backend that scales no lengths refuses it`, () => {
  test(`${AC[6]} a world that writes no length_unit gives step hashes byte-identical to the merge base's`, () => {
    const baked = bake(world(null), STEPS, { read: [] });
    const here = ask([baked]);
    expect(here.problem, `${here.what} answers`).toBe('');
    const there = askBase([baked]);
    expect(there.problem, `${there.what} answers`).toBe('');
    const on = `on the merge base ${there.sha.slice(0, 12)}`;
    const [a, b] = [hashesOf(here.replies[0]!, 'the stack with no length_unit, here'), hashesOf(there.replies[0]!, `the stack with no length_unit, ${on}`)];
    expect([a, b].filter((x) => typeof x === 'string'), 'both runs bake the stack of five 1 cm cubes at step_rate 480 and contact_hz 240 with no length_unit').toEqual([]);
    const [mine, theirs] = [a as string[], b as string[]];
    console.log(`step hashes with no length_unit: ${mine.length} here, ${theirs.length} ${on}; the last ${String(mine.at(-1))} and ${String(theirs.at(-1))}`);
    const failures = sameFailures(mine, theirs, STEPS, 'the stack with no length_unit', on);
    expect(failures, `step hashes against the merge base's:\n  ${failures.join('\n  ')}`).toEqual([]);
    // The comparison isn't vacuous: the stack settles, so its last hash isn't its first, and the same judge fails on
    // the same run with its last hash swapped for its first.
    expect(mine.at(-1) === mine[0], 'the last step\'s hash is the built state\'s: nothing moved').toBe(false);
    expect(sameFailures(mine.map((h, k) => (k === STEPS ? mine[0]! : h)), theirs, STEPS, 'the swapped run', on).length, 'the judge catches a run whose last step hash is another step\'s').toBeGreaterThan(0);
  }, 4 * TIMEOUT);

  test(`${AC[6]} two worlds that differ only in length_unit have different bake keys, and the field is held to its range: at or below 0 and above 1 are refused naming ${FIELD}`, () => {
    const out = [0, -0.01, 1.01];
    const run = ask([bake(world(0.01), 2, { read: [] }), bake(world(0.01), 2, { read: [] }), bake(world(0.1), 2, { read: [] }), ...out.map((x) => check(world(x))), check(world(1))]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [first, again, other] = [keyOf(run.replies[0]!), keyOf(run.replies[1]!), keyOf(run.replies[2]!)];
    console.log(`bake keys: length_unit 0.01 ${first || 'none'}, the same again ${again || 'none'}, length_unit 0.1 ${other || 'none'}`);
    const unbaked = run.replies.slice(0, 3).filter((r) => keyOf(r) === '').map((r) => `no key: ${refusal(r)}`);
    expect(unbaked, 'each of the three worlds bakes and has a key').toEqual([]);
    // Not vacuous: a key is the world's, the same for the same world, so two that differ show a difference of worlds.
    expect(again, 'the same world baked twice has one key').toBe(first);
    expect(other, 'the world at length_unit 0.1 has another key than the same world at 0.01').not.toBe(first);
    const failures = [
      ...out.flatMap((x, i) => refusedFailures(run.replies[3 + i]!, { code: 'out_of_range', actual: x }, `length_unit ${x}`)),
      ...acceptedFailures(run.replies[3 + out.length]!, 'length_unit 1'),
    ];
    expect(failures, `the field's range:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[6]} on the test backend ${NO_LENGTH_UNIT}, whose caps() say it scales no lengths, length_unit 0.01 is refused naming ${FIELD} and the backend, while the reference backend of the same build accepts it`, () => {
    const own = ask([{ call: 'backend' }, check(world(0.01))], { backend: NO_LENGTH_UNIT });
    expect(own.problem, `${own.what} answers: the test-backends build holds the test backend ${NO_LENGTH_UNIT}`).toBe('');
    const named = backendOf(own.replies[0]!, `backend (${NO_LENGTH_UNIT})`);
    expect(named, 'the test backend is a candidate under its own name').toEqual({ backend: NO_LENGTH_UNIT, reference: false });
    const failures = refusedFailures(own.replies[1]!, { code: 'physics.backend_cap', actual: 0.01, backend: NO_LENGTH_UNIT }, 'length_unit 0.01');
    console.log(`length_unit 0.01 on ${NO_LENGTH_UNIT}: ${JSON.stringify(own.replies[1]!['issues']).slice(0, 600)}`);
    // The refusal is that backend's caps', not every backend's: the reference of the same build takes the same world.
    const reference = ask([check(world(0.01))], { build: 'test' });
    expect(reference.problem, `${reference.what} answers (the test-backends build, on ${REFERENCE})`).toBe('');
    failures.push(...acceptedFailures(reference.replies[0]!, `length_unit 0.01 on ${REFERENCE} in the same build`));
    expect(failures, `length_unit 0.01 by caps():\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[6]} a planted check that reads only the field's range accepts length_unit 0.01 on ${NO_LENGTH_UNIT} and fails, naming ${FIELD} and the backend`, () => {
    const run = ask([check(world(0.01)), check(world(0))], { backend: NO_LENGTH_UNIT, planted: PLANTED });
    expect(run.problem, `${run.what} answers`).toBe('');
    const accepted = acceptedFailures(run.replies[0]!, `length_unit 0.01 on ${NO_LENGTH_UNIT} under ${PLANTED}`);
    expect(accepted, `the planted check accepts it:\n  ${accepted.join('\n  ')}`).toEqual([]);
    // It still reads the field's range.
    const range = refusedFailures(run.replies[1]!, { code: 'out_of_range', actual: 0 }, `length_unit 0 under ${PLANTED}`);
    expect(range, `the planted check still refuses a value out of the field's range:\n  ${range.join('\n  ')}`).toEqual([]);
    const failures = refusedFailures(run.replies[0]!, { code: 'physics.backend_cap', actual: 0.01, backend: NO_LENGTH_UNIT }, `length_unit 0.01 under ${PLANTED}`);
    console.log(`planted ${PLANTED}: ${failures.join('; ')}`);
    expect(failures.some((f) => f.includes(FIELD) && f.includes(NO_LENGTH_UNIT)), `the judge that passes the real check fails on the planted one, naming the field and the backend:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});

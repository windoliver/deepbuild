// Criterion 4: ten dominoes of 48 × 24 × 7.5 mm, 20 mm apart, friction 0.5, in the same world with `length_unit: 0.01`,
// the first tipped 10° about its far bottom edge: all ten pass 45° in order, the last between 0.6 s and 0.8 s, and at
// 4 s no two neighbours are more than 0.05 of a thickness inside each other. The planted wrapper that ignores
// `solver.contact_hz` leaves two more than 0.2 of a thickness inside each other and fails, naming the pair.
import { describe, expect, test } from 'vitest';
import {
  AC, DOMINO, DOMINOES, RATE, TIMEOUT, ask, bake, dominoOf, dominoRead, dominoes, kitCall, kitFailures, prebuild, show,
  type DominoRead, type Planted,
} from './helpers.ts';

prebuild(['release']);

const FIXTURE = dominoes();
const PLANTED: Planted = 'wrapper_ignores_contact_hz';
const IDS = Array.from({ length: DOMINOES }, (_, i) => dominoOf(i + 1));
const CALLS = [bake(FIXTURE.world, FIXTURE.steps, { read: IDS }), { call: 'behavior_fixtures' }, kitCall()];
const shown = (r: DominoRead): string =>
  `pass 45° at steps ${r.passed.map(String).join(', ')} (the last at ${typeof r.passed[DOMINOES - 1] === 'number' ? (r.passed[DOMINOES - 1]! / RATE).toFixed(3) : '?'} s); inside each other at 4 s, in thicknesses: ${r.depths.map((d) => (d / DOMINO.thick).toFixed(3)).join(' ')}`;

describe(`${AC[4]} ten dominoes at step_rate 480, contact_hz 240 and length_unit 0.01`, () => {
  test(`${AC[4]} all ten pass 45° in order, the last between 0.6 s and 0.8 s, and at 4 s no two neighbours are more than 0.05 of a thickness inside each other; the kit's ${FIXTURE.name} holds that world and passes on it`, () => {
    const run = ask(CALLS);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = dominoRead(run.replies[0]!, FIXTURE.steps, 'the dominoes');
    if (read.pair) console.log(`the dominoes: ${shown(read)}`);
    const kit = kitFailures(run.replies[1]!, run.replies[2]!, FIXTURE, 'pass', read.measured, 'the behavior kit');
    const failures = [...read.failures, ...kit.failures];
    expect(failures, `the dominoes:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} the planted wrapper that ignores solver.contact_hz leaves two more than 0.2 of a thickness inside each other and fails, naming the pair`, () => {
    const run = ask(CALLS, { planted: PLANTED });
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = dominoRead(run.replies[0]!, FIXTURE.steps, `the dominoes under ${PLANTED}`);
    if (read.pair) console.log(`planted ${PLANTED}: ${shown(read)}`);
    expect(read.measured === null ? read.failures.join('; ') : read.measured > 0.2 * DOMINO.thick, 'the planted wrapper leaves two neighbours more than 0.2 of a thickness inside each other at 4 s').toBe(true);
    const [a, b] = read.pair ?? ['', ''];
    expect(read.failures.some((f) => f.startsWith(`${a} and ${b}:`)), `the judge that passes the real program fails on the planted wrapper, naming the pair ${a} and ${b}:\n  ${read.failures.join('\n  ')}`).toBe(true);
    // The fixture in the kit fails on the same wrapper, its row naming the pair.
    const kit = kitFailures(run.replies[1]!, run.replies[2]!, FIXTURE, 'fail', read.measured, `the behavior kit under ${PLANTED}`);
    const named = kit.row && Array.isArray(kit.row.raw['bodies']) ? kit.row.raw['bodies'] : [];
    if (kit.row && !(named.length === 2 && named.includes(a) && named.includes(b))) kit.failures.push(`${FIXTURE.name}: the fail names bodies ${show(kit.row.raw['bodies'])}, not the pair ${a} and ${b}`);
    expect(kit.failures, `the kit's ${FIXTURE.name} under ${PLANTED}:\n  ${kit.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});

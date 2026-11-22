// Criterion 2: in the same world, five 1 cm cubes of density 1,000 kg/m³ and friction 0.5 set one on another end with
// the top one's centre within 2% of a side of 4.5 sides up and within 1% of a side aside, and none moves faster than
// 1 mm/s in the third second. A 1 cm ball of restitution 0.5 dropped with its lowest point 0.1 m above a floor of
// restitution 0, under the `max` rule, first bounces to 0.025 m within 3%. A 1 cm cube of friction 0.5 on a floor of 0.5
// slides from 0.700 m/s to rest in 0.05 m within 3%. A planted wrapper that ignores `solver.contact_hz` and keeps the
// backend's own leaves the stack more than half a side low and fails, naming the top body.
import { describe, expect, test } from 'vitest';
import {
  AC, SIDE, TIMEOUT, TOP, ask, bake, bounce, bounceRead, kitCall, kitFailures, prebuild, show, slide, slideRead, stack,
  stackRead, type Planted,
} from './helpers.ts';

prebuild(['release']);

const [STACK, BOUNCE, SLIDE] = [stack(), bounce(), slide()];
const PLANTED: Planted = 'wrapper_ignores_contact_hz';
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

describe(`${AC[2]} the stack, the bounce and the slide of 1 cm bodies at step_rate 480, contact_hz 240 and length_unit 0.01`, () => {
  test(`${AC[2]} five cubes end 4.5 sides up within 2% of a side, within 1% aside and under 1 mm/s through the third second; the ball first bounces to 0.025 m and the cube slides 0.05 m to rest, each within 3%; the kit's three fixtures hold those worlds and pass`, () => {
    const run = ask([bake(STACK.world, STACK.steps), bake(BOUNCE.world, BOUNCE.steps), bake(SLIDE.world, SLIDE.steps), { call: 'behavior_fixtures' }, kitCall()]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [fixtures, report] = [run.replies[3]!, run.replies[4]!];
    const stood = stackRead(run.replies[0]!, STACK.steps, 'the stack');
    const bounced = bounceRead(run.replies[1]!, BOUNCE.steps, SIDE / 2, 0.025, 'the bounce');
    const slid = slideRead(run.replies[2]!, SLIDE.steps, 'the slide');
    if (stood.low !== null && stood.aside !== null) console.log(`the stack: the top ends ${pct(stood.low / SIDE)} of a side low and ${pct(stood.aside / SIDE)} aside; largest speeds in the third second: ${stood.fastest.map((f) => `${f.id} ${(f.speed * 1000).toFixed(4)} mm/s`).join(', ')}`);
    if (bounced.height !== null) console.log(`the bounce: ${bounced.height.toFixed(5)} m beside 0.025 m (${pct(bounced.height / 0.025 - 1)})`);
    if (slid.moved !== null) console.log(`the slide: ${slid.moved.toFixed(5)} m beside 0.05 m (${pct(slid.moved / 0.05 - 1)})`);
    const failures = [
      ...stood.failures, ...bounced.failures, ...slid.failures,
      ...kitFailures(fixtures, report, STACK, 'pass', stood.measured, 'the behavior kit').failures,
      ...kitFailures(fixtures, report, BOUNCE, 'pass', bounced.measured, 'the behavior kit').failures,
      ...kitFailures(fixtures, report, SLIDE, 'pass', slid.measured, 'the behavior kit').failures,
    ];
    expect(failures, `the stack, the bounce and the slide:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[2]} a planted wrapper that ignores solver.contact_hz and keeps the backend's own leaves the stack more than half a side low and fails, naming the top body`, () => {
    const run = ask([bake(STACK.world, STACK.steps), { call: 'behavior_fixtures' }, kitCall()], { planted: PLANTED });
    expect(run.problem, `${run.what} answers`).toBe('');
    const stood = stackRead(run.replies[0]!, STACK.steps, `the stack under ${PLANTED}`);
    console.log(`planted ${PLANTED}: the top ends ${stood.low === null ? 'unread' : `${(stood.low / SIDE).toFixed(3)} sides`} below 4.5 sides`);
    expect(stood.low === null ? stood.failures.join('; ') : stood.low > SIDE / 2, 'the planted wrapper leaves the top cube\'s centre more than half a side below 4.5 sides').toBe(true);
    expect(stood.failures.some((f) => f.startsWith(`${TOP}:`)), `the judge that passes the real program fails on the planted wrapper, naming the top body:\n  ${stood.failures.join('\n  ')}`).toBe(true);
    // The fixture in the kit fails on the same wrapper, its row naming the top body.
    const kit = kitFailures(run.replies[1]!, run.replies[2]!, STACK, 'fail', stood.measured, `the behavior kit under ${PLANTED}`);
    if (kit.row && kit.row.raw['body'] !== TOP) kit.failures.push(`${STACK.name}: the fail names body ${show(kit.row.raw['body'])}, not the top body ${TOP}`);
    expect(kit.failures, `the kit's ${STACK.name} under ${PLANTED}:\n  ${kit.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});

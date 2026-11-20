// Criterion 3: a dynamic bar 2 m long and 0.02 m thick, turning at 720°/s about its centre with no linear velocity and
// `ccd` off, raises `physics.fast_body` naming the bar, its fastest point's 0.105 m move in a step and its 0.01 m half
// extent, and the default turns `ccd` on with one assumption row. A planted lint that reads only the body's move raises
// nothing and fails, naming the bar.
import { describe, expect, test } from 'vitest';
import {
  AC, BAR, BAR_FAST, BAR_MOVE, TIMEOUT, bake, barWorld, expand, fastFailures, kitRunOf, lintOf, physics, planted, prebuild,
  rowFailures, show, statesOf, tolds,
} from './helpers.ts';

prebuild(['release']);
const STEPS = 12;
const list = (failures: readonly string[]): string => `\n  ${failures.join('\n  ')}`;

describe(`${AC[3]} physics.fast_body counts a turning body's fastest point`, () => {
  test(`${AC[3]} a bar turning at 720°/s in place with ccd off raises physics.fast_body naming the bar, its fastest point's 0.105 m move in a step and its 0.01 m half extent, and the default turns ccd on with one assumption row`, () => {
    // Its turn in a step, 6°, times its farthest extent from its centre, √(1² + 0.01² + 0.01²) m.
    expect(BAR_MOVE.toFixed(3), 'the worked move of the bar\'s fastest point in a step, m').toBe('0.105');
    const [baked, run] = physics([bake(barWorld(false), STEPS), expand(barWorld(undefined))]);
    const what = 'the turning bar';
    // The bar turns in place: its centre never moves, so a lint that reads only its move sees nothing.
    const drift = Math.max(...statesOf(baked!, BAR, what).map((s) => Math.hypot(...s.pos)));
    console.log(`${what}: its centre moves at most ${drift} m in ${STEPS} steps; physics.fast_body raises ${tolds(lintOf(baked!, what).raised)}`);
    console.log(`${what}, ccd unset, through the kit: rows ${show(kitRunOf(run!).rows)}`);
    expect(drift, 'the bar turns about its centre with no linear velocity').toBeLessThan(1e-4);
    const failures = [...fastFailures(baked!, BAR_FAST, what), ...rowFailures(run!, BAR, 'the turning bar with ccd unset')];
    expect(failures, `${what}:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} a planted lint that reads only the body's move raises nothing and fails, naming the bar`, () => {
    const twin = planted('lint_reads_move_only', [bake(barWorld(false), STEPS)]);
    expect(twin.refused, 'the planted lint runs').toBe('');
    const baked = twin.replies[0]!;
    const { raised, unread } = lintOf(baked, 'the planted lint');
    console.log(`planted lint_reads_move_only: physics.fast_body raises ${tolds(raised)}`);
    expect(unread, 'the planted lint ran over the bake').toEqual([]);
    expect(raised, 'the planted lint raises nothing for the bar').toEqual([]);
    const failures = fastFailures(baked, BAR_FAST, 'the planted lint');
    console.log(`planted lint_reads_move_only fails:${list(failures)}`);
    expect(failures.length, 'the judge of the real lint fails on the planted one').toBeGreaterThan(0);
    expect(failures.some((f) => f.startsWith(`${BAR}:`)), `a failure names the bar:${list(failures)}`).toBe(true);
  }, TIMEOUT);
});

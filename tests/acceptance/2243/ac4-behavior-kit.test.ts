// #2243.2a71ec4b: "A test backend that wraps Rapier and leaves each moved character's pose stale until the backend step
// fails the kit's head-on fixture, naming the backend, the fixture, the 0.609 m bound and the 0.600 m it read. A test
// backend without a character controller reads `excluded_by_caps` on both fixtures and passes the rest"
//
// #191's calls on the `test-backends` build (README: The fixtures in the behavior kit). `behavior_fixtures` holds
// `character/head_on` and `character/into_standing` once each, with the issue's world, 0.61 m and 1 mm, each naming
// the cap `character_controller`; `behavior_kit` on Rapier passes both within 1 mm of 0.61 m.
//
// On `--backend stale_character_poses` the kit's `character/head_on` row reads `fail`, its `backend` the test
// backend's, and its `what` names the backend, the fixture, 0.609 and the 0.600 m it read. What it read is checked
// against the bake: the fixture's own world, baked on that backend over the fixture's own track and steps, first ends
// a step with the two axes under 0.609 m apart at 0.600 m, within half a unit of that last digit, and `what` names
// that distance. On #182's `--backend no_character_controller` both fixtures read `excluded_by_caps`, every other
// fixture naming a cap the backend lacks reads the same, and every fixture left reads `pass`, the verdict `pass`.
import { describe, expect, it } from 'vitest';
import {
  AC, BOUND, CHARACTER_CAP, HEAD_ON, INTO_STANDING, KIT_FIXTURES, TIMEOUT, ask, axes, backendOf, fixtureFailures, fixturesNamed, fmt,
  kitReport, namesNumber, passFailures, prebuild, show, statesOf, under, walkersIn, type TestBackend,
} from './helpers.ts';

prebuild(['test']);

const ID = AC[4];
const STALE: TestBackend = 'stale_character_poses';
const BARE: TestBackend = 'no_character_controller';
const CALLS = [{ call: 'backend' }, { call: 'behavior_fixtures' }, { call: 'behavior_kit' }];

describe(`${ID} the two fixtures in the behavior kit: a backend that leaves moved characters' poses stale fails the head-on one, and one without a character controller is excluded from both`, () => {
  it(`${ID} a test backend that leaves each moved character's pose stale until the backend step (--backend ${STALE}) fails ${HEAD_ON}, naming the backend, the fixture, the 0.609 m bound and the 0.600 m it read`, () => {
    const stale = ask(CALLS, { backend: STALE });
    expect(stale.problem, `deep-physics --backend ${STALE} runs in the test-backends build and answers the kit's calls`).toBe('');
    const [info, data, kit] = [backendOf(stale.replies[0]!, STALE), stale.replies[1]!, kitReport(stale.replies[2]!, `the kit on ${STALE}`)];
    const held = fixtureFailures(data, HEAD_ON);
    expect(held, `${HEAD_ON} in the kit's data:\n  ${held.join('\n  ')}`).toEqual([]);
    const fixture = fixturesNamed(data, HEAD_ON)[0]!;

    // What the fixture's own run reads on the backend: the first step that ends with the axes under the bound.
    const [p, q] = walkersIn(fixture.world).map((w) => w.id) as [string, string];
    const own = ask([{ call: 'bake', world: fixture.world, steps: fixture.steps, track: fixture.track, read: [p, q] }], { backend: STALE });
    expect(own.problem, `deep-physics --backend ${STALE} bakes ${HEAD_ON}'s own world over its own track and steps`).toBe('');
    const what = `${HEAD_ON}'s world baked on ${STALE}`;
    const [a, b] = [statesOf(own.replies[0]!, p, what), statesOf(own.replies[0]!, q, what)];
    const { first } = under(a, b, BOUND);
    expect(first, `${what} ends a step with ${p}'s and ${q}'s axes under ${BOUND} m apart`).toBeGreaterThan(0);
    const read = axes(a[first]!, b[first]!);
    expect(Math.abs(read - 0.6), `${what} reads 0.600 m at step ${first}, the first step under the bound (it reads ${fmt(read)} m)`).toBeLessThanOrEqual(0.0005);

    const failures: string[] = [];
    if (info.backend !== STALE) failures.push(`the backend's manifest names ${info.backend}, not ${STALE}`);
    if (!info.caps.includes(CHARACTER_CAP)) failures.push(`${STALE}'s caps() ${show(info.caps)} don't claim ${CHARACTER_CAP}, so the kit can't run the fixture on it`);
    if (!kit.admitted) failures.push(`the kit refuses ${STALE} before any fixture runs: ${show(kit.refused)}`);
    const rows = kit.results.filter((r) => r.fixture === HEAD_ON);
    if (rows.length !== 1) failures.push(`the kit's report on ${STALE} holds ${HEAD_ON} ${rows.length} times, not once`);
    for (const row of rows) {
      if (row.result !== 'fail') failures.push(`${HEAD_ON} reads ${row.result} on ${STALE}, not fail: ${row.what}`);
      if (row.backend !== STALE) failures.push(`the row's backend is ${row.backend}, not ${STALE}`);
      if (!row.what.includes(STALE)) failures.push(`the failure doesn't name the backend ${STALE}: ${JSON.stringify(row.what)}`);
      if (!row.what.includes(HEAD_ON)) failures.push(`the failure doesn't name the fixture ${HEAD_ON}: ${JSON.stringify(row.what)}`);
      if (!namesNumber(row.what, BOUND, 1e-6)) failures.push(`the failure doesn't name the ${BOUND} m bound: ${JSON.stringify(row.what)}`);
      if (!namesNumber(row.what, read, 0.0005)) failures.push(`the failure doesn't name the 0.600 m it read (${fmt(read)} m at step ${first} of its own run): ${JSON.stringify(row.what)}`);
    }
    expect(failures, `${HEAD_ON} on ${STALE}:\n  ${failures.join('\n  ')}`).toEqual([]);

    // The fixture can fail: the same fixture passes on Rapier, in the same build.
    const rapier = ask([{ call: 'behavior_kit' }], { build: 'test' });
    expect(rapier.problem, 'deep-physics (the test-backends build, on Rapier) runs the kit').toBe('');
    const passes = passFailures(kitReport(rapier.replies[0]!, 'the kit on Rapier'), fixture);
    expect(passes, `${HEAD_ON} on Rapier:\n  ${passes.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} a test backend without a character controller (--backend ${BARE}) reads excluded_by_caps on ${HEAD_ON} and ${INTO_STANDING} and passes the rest; Rapier passes both`, () => {
    const bare = ask(CALLS, { backend: BARE });
    expect(bare.problem, `deep-physics --backend ${BARE} runs in the test-backends build and answers the kit's calls`).toBe('');
    const [info, data, kit] = [backendOf(bare.replies[0]!, BARE), bare.replies[1]!, kitReport(bare.replies[2]!, `the kit on ${BARE}`)];
    expect(info.caps, `${BARE}'s caps() claim no character controller`).not.toContain(CHARACTER_CAP);
    const held = KIT_FIXTURES.flatMap((name) => fixtureFailures(data, name));
    expect(held, `the two fixtures in the kit's data:\n  ${held.join('\n  ')}`).toEqual([]);

    const failures: string[] = [];
    if (!kit.admitted) failures.push(`the kit refuses ${BARE} before any fixture runs: ${show(kit.refused)}`);
    for (const name of KIT_FIXTURES) {
      const rows = kit.results.filter((r) => r.fixture === name);
      if (rows.length !== 1 || rows[0]!.result !== 'excluded_by_caps') failures.push(`${name} reads ${rows.map((r) => r.result).join(', ') || 'nothing'} on ${BARE}, not excluded_by_caps once`);
    }
    for (const row of kit.results) {
      const lacks = row.caps.filter((c) => !info.caps.includes(c));
      if (lacks.length && row.result !== 'excluded_by_caps') failures.push(`${row.fixture} names ${lacks.join(', ')}, which ${BARE}'s caps() lack, yet reads ${row.result}`);
      if (!lacks.length && row.result !== 'pass') failures.push(`${row.fixture}, one of the rest, reads ${row.result} on ${BARE}, not pass: ${row.what}`);
    }
    if (kit.verdict !== 'pass') failures.push(`the kit's verdict on ${BARE} is ${kit.verdict}, not pass`);
    expect(failures, `the kit on ${BARE}:\n  ${failures.join('\n  ')}`).toEqual([]);

    // Excluded from fixtures that can pass: Rapier, in the same build, passes both.
    const rapier = ask([{ call: 'behavior_kit' }], { build: 'test' });
    expect(rapier.problem, 'deep-physics (the test-backends build, on Rapier) runs the kit').toBe('');
    const report = kitReport(rapier.replies[0]!, 'the kit on Rapier');
    const passes = KIT_FIXTURES.flatMap((name) => passFailures(report, fixturesNamed(data, name)[0]!));
    expect(passes, `the two fixtures on Rapier:\n  ${passes.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});

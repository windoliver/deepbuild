// Criterion 4: `tangent_speed: 1` on a dynamic body's shape use is refused at check, naming the field.
// `rolling_resistance: 0.05` is still refused on Rapier, naming the field and the backend. A test backend that wraps
// Rapier and leaves belts out of its `caps()` reads `excluded_by_caps` on the belt fixtures and refuses the first world,
// naming the field.
import { describe, expect, test } from 'vitest';
import {
  AC, BELT, BOX, LEVEL, NO_BELTS, REFERENCE, SPEED, TILTED, TIMEOUT, acceptedFailures, ask, beltOnDynamic, check, field, fixturesOf, kitCall,
  levelBelt, manifestOf, prebuild, refusal, refusalFailures, rolling, rowOf, show, writesBelt, type Fixture, type Manifest,
} from './helpers.ts';

prebuild(['release', 'test']);

describe(`${AC[4]} a belt on a dynamic body, rolling resistance, and a belt on a backend without belts are refused at check`, () => {
  test(`${AC[4]} on Rapier, tangent_speed 1 on the dynamic box's shape use is refused naming the field while the static belt's is taken, and rolling_resistance 0.05 is still refused naming the field and ${REFERENCE}`, () => {
    const run = ask([check(levelBelt()), check(beltOnDynamic()), check(rolling())]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [onStatic, onDynamic, rolled] = [run.replies[0]!, run.replies[1]!, run.replies[2]!];
    console.log(`tangent_speed 1 on the dynamic box: ${show(onDynamic['issues'])}\nrolling_resistance 0.05: ${show(rolled['issues'])}`);
    const failures = [
      // The refusal is the dynamic body's, not every belt's: the same field on the static belt, the first world, is taken.
      ...acceptedFailures(onStatic, 'the first world, tangent_speed 1 on its static belt,'),
      ...refusalFailures(onDynamic, { field: field(BOX, 'tangent_speed'), actual: SPEED }, 'tangent_speed 1 on the dynamic box\'s shape use'),
      ...refusalFailures(rolled, { field: field(BOX, 'rolling_resistance'), actual: 0.05, backend: REFERENCE }, 'rolling_resistance 0.05'),
    ];
    expect(failures, `the checks on ${REFERENCE}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} the test backend ${NO_BELTS}, Rapier with belts left out of its caps(), reads excluded_by_caps on the belt fixtures, which pass on Rapier, and refuses the first world naming the field`, () => {
    const own = ask([{ call: 'backend' }, kitCall(), check(levelBelt())], { backend: NO_BELTS });
    expect(own.problem, `${own.what} answers: the test-backends build holds the test backend ${NO_BELTS}`).toBe('');
    const rapier = ask([{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()], { build: 'test' });
    expect(rapier.problem, `${rapier.what} answers (the test-backends build, on Rapier)`).toBe('');
    const [mine, theirs] = [manifestOf(own.replies[0]!, `backend (${NO_BELTS})`), manifestOf(rapier.replies[1]!, 'backend (Rapier, test build)')];
    const data = fixturesOf(rapier.replies[0]!, 'behavior_fixtures (test build)');
    const unread = [mine, theirs, data].filter((x): x is string => typeof x === 'string');
    expect(unread, 'the two manifests and the kit\'s data are read').toEqual([]);
    const [caps, reference, fixtures] = [mine as Manifest, theirs as Manifest, data as Fixture[]];

    // The belt fixtures: every fixture whose world writes a belt, the two the criteria call a fixture among them.
    const belts = fixtures.filter((f) => writesBelt(f.world));
    const failures = [LEVEL, TILTED].filter((n) => !belts.some((f) => f.name === n)).map((n) => `the kit's data holds no belt fixture ${n}; its belt fixtures: ${belts.map((f) => f.name).join(', ') || 'none'}`);
    // It wraps Rapier as a candidate under its own name, and leaves out of Rapier's caps() what a belt fixture needs.
    if (caps.backend !== NO_BELTS || caps.reference) failures.push(`${NO_BELTS}'s manifest names ${caps.backend}, reference ${String(caps.reference)}: not a candidate under its own name`);
    const dropped = reference.caps.filter((c) => !caps.caps.includes(c));
    console.log(`${NO_BELTS} leaves ${show(dropped)} out of Rapier's caps ${show(reference.caps)}; belt fixtures: ${belts.map((f) => `${f.name} ${show(f.caps)}`).join(', ')}`);
    for (const f of belts) {
      if (!f.caps.some((c) => dropped.includes(c))) failures.push(`${f.name} names caps ${show(f.caps)}, none of them one ${NO_BELTS} leaves out of Rapier's caps() (it leaves out ${show(dropped)})`);
      const excluded = rowOf(own.replies[1]!, f.name, `behavior_kit on ${NO_BELTS}`);
      if (typeof excluded === 'string') failures.push(`${excluded} (its report: admitted ${show(own.replies[1]!['admitted'])}, verdict ${show(own.replies[1]!['verdict'])})`);
      else if (excluded.result !== 'excluded_by_caps') failures.push(`${f.name} reads ${excluded.result} on ${NO_BELTS}, not excluded_by_caps: ${excluded.what}`);
      // Not excluded everywhere: the same build's Rapier, whose caps() have belts, runs it and passes.
      const passed = rowOf(rapier.replies[2]!, f.name, 'behavior_kit on Rapier (test build)');
      if (typeof passed === 'string') failures.push(passed);
      else if (passed.result !== 'pass') failures.push(`${f.name} reads ${passed.result} on Rapier in the same build, not pass: ${passed.what}`);
    }
    // And a world that needs a belt is refused on it: the first world, naming the field.
    console.log(`the first world on ${NO_BELTS}: ${refusal(own.replies[2]!)}`);
    failures.push(...refusalFailures(own.replies[2]!, { field: field(BELT, 'tangent_speed'), actual: SPEED }, `the first world on ${NO_BELTS}`));
    expect(failures, `${NO_BELTS}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
